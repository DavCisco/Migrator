const express = require('express');
//const ejs = require("ejs");
const request = require("request");
const jsxapi = require('jsxapi');
const path = require('path');

// Webex integration details

const clientId = 'C4927e3a0522cd588a4aee82e41343fb61e1ee50659ac54491584c9ce3894ce02';
const clientSecret = '3490721c4f5a4325231ac314b786fcdb2ad0bdcdc85a2c209299f57ce615bce4';
// the scopes separator is a space, example: "spark:people_read spark:rooms_read"
// Note: spark:kms is added by default in the integration definition
const scopes = 'spark:kms spark:all spark-admin:devices_write spark-admin:places_write';
const port = '8080';
const redirectURI = `http://localhost:${port}/oauth`;
// not used
const state = 'Challenge';

const app = express();
// path to serve static content (css & js) for EJS templates
app.use(express.static(path.join(__dirname, 'www/assets')));
// to support URL-encoded bodies by the client (for POST) 
app.use(express.urlencoded({extended: true}));

// For output of the Oauth procedure
var token;
var user;
var org;

// Variables for the migration
//    endpoint: includes the full state of the migration, including
//    the description since it cannot be resolved in the HTML/EJS page
//    fields:
//      id: counter (from 0)
//      ip: IP address (from the .csv)
//      place: name of the place (from the .csv)
//      status: numeric:
//          0 = initial state
//          1 = migration completed 
//         >1 = errors
//      statusDesc: corresponding descriptions
var endpoints = [];
// credentials for the on-prem endpoints
var username, password, disableAdmin;


// Step 1: initiate the OAuth flow
//   - serves a Web page with a link to the Webex OAuth flow initializer

app.get('/', function (req, res) {
    console.log('serving the Migrator home page');

    const initiateURL = "https://api.ciscospark.com/v1/authorize?"
        + "client_id=" + clientId
        + "&response_type=code"
        + "&redirect_uri=" + encodeURIComponent(redirectURI)
        + "&scope=" + encodeURIComponent(scopes)
        + "&state=" + state;
    res.render('index.ejs', { "link": initiateURL });

});

app.get('/index.html', function (req, res) {
    res.redirect('/');
});

// Step 2: process OAuth on redirect from Webex Oauth
app.get('/oauth', function (req, res) {
    console.log("Oauth callback (redirect) received");

    if (req.query.error) {
        if (req.query.error == "access_denied") {
            console.log("User declined, received err: " + req.query.error);
            // starting over from the home page
            res.redirect("/index.html");
            return;
        }
        if (req.query.error == "invalid_scope") {
            console.log("Wrong scope requested, received err: " + req.query.error);
            res.send("<h1>OAuth Integration could not complete</h1><p>The application is requesting an invalid scope.</p>");
            return;
        }
        if (req.query.error == "server_error") {
            console.log("server error, received err: " + req.query.error);
            res.send("<h1>OAuth Integration could not complete</h1><p>Webex sent a server error, try again later.</p>");
            return;
        }
        console.log("received err: " + req.query.error);
        res.send("<h1>OAuth Integration could not complete</h1><p>Unexpected error.</p>");
        return;
    }
    // Oauth successful so far
    // Retrieves the access token - parameters for the API call
    var options = {
    method: 'POST',
    url: 'https://api.ciscospark.com/v1/access_token',
    headers: {"content-type": "application/x-www-form-urlencoded"},
    form: {        
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code: req.query.code,
        redirect_uri: redirectURI}
    };
    request(options, function (error, response, body) {
        if (error) {
            console.log("could not reach Webex cloud to retreive access & refresh tokens");
            res.send("<h1>OAuth Integration could not complete</h1><p>Sorry, could not retreive your access token. Try again.</p>");
            return;
        }
        if (response.statusCode != 200) {
            console.log("access token not issued with status code: " + response.statusCode);
            switch (response.statusCode) {
                case 400:
                    const responsePayload = JSON.parse(response.body);
                    res.send("<h1>OAuth Integration could not complete</h1><p>Bad request. <br/>" + responsePayload.message + "</p>");
                    break;
                case 401:
                    res.send("<h1>OAuth Integration could not complete</h1><p>OAuth authentication error. Check the secret.</p>");
                    break;
                default:
                    res.send("<h1>OAuth Integration could not complete</h1><p>Sorry, could not retreive your access token. Try again.</p>");
                    break;
            }
            return;
        }
        // Check payload (tokens)
        const json = JSON.parse(body);
        if ((!json) || (!json.access_token) || (!json.expires_in) || (!json.refresh_token) || (!json.refresh_token_expires_in)) {
            console.log("could not parse access & refresh tokens");
            res.send("<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve your access token. Try again.</p>");
            return;
        }
        //console.log("OAuth flow completed, fetched tokens: " + JSON.stringify(json));
        console.log("OAuth flow completed, fetched tokens.");
        
        // OAuth flow has completed
        // Note: the refresh token (valid 90 days) can be used to reissue later a new access token (valid 14 days)
        // token stored as global variable
        token = json.access_token;
    
        // With the token, retrieves the user details: GET https://api.ciscospark.com/v1/people/me
        var options = {
            method: 'GET',
            url: 'https://api.ciscospark.com/v1/people/me',
            headers: { "authorization": "Bearer " + token }
        };
        request(options, function (error, response, body) {
            if (error) {
                console.log("could not reach Webex API to retrieve the user details, error: " + error);
                res.send("<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve your Webex Teams account details. Try again.</p>");
                return;
            }
            // Check if the call is successful
            if (response.statusCode != 200) {
                console.log("could not retreive your details, /people/me returned: " + response.statusCode);
                res.send("<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve your Webex Teams account details. Try again.</p>");
                return;
            }
            // stores the user as global variable
            user = JSON.parse(body).displayName;

            // Also retrieves the org name - GET https://api.ciscospark.com/v1/organizations

            var options = {
                method: 'GET',
                url: 'https://api.ciscospark.com/v1/organizations',
                headers: { "authorization": "Bearer " + token }
            };
            request(options, function (error, response, body) {
                if (error) {
                    console.log("could not reach Webex API to retrieve the org details, error: " + error);
                    res.send("<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve your Webex Teams org details. Try again.</p>");
                    return;
                }
                // Check if the call is successful
                if (response.statusCode != 200) {
                    console.log("could not retreive your org details, /organizations returned: " + response.statusCode);
                    res.send("<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve your Webex Teams org details. Try again.</p>");
                    return;
                }
                // stores the org as global variable
                org = JSON.parse(body).items[0].displayName;

                // Also retrieves the list of the devices - GET https://api.ciscospark.com/v1/devices

                const options = {
                    method: 'GET',
                    url: 'https://api.ciscospark.com/v1/devices',
                    headers: { "authorization": "Bearer " + token }
                };
                request(options, function (error, response, body) {
                    if (error) {
                        console.log("could not reach Webex API to retreive the device list, error: " + error);
                        res.send("<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve the device list. Try again.</p>");
                        return;
                    }
                    // Check if the call is successful
                    if (response.statusCode != 200) {
                        console.log("could not retreive the device list, /devices returned: " + response.statusCode);
                        res.send("<h1>OAuth Integration could not complete</h1><p>Sorry, could not retrieve the device list. Try again.</p>");
                        return;
                    }
                    // json is an array
                    const json = JSON.parse(body);
                    var devices = [];
                    var i;
                    for (i = 0; i < json.items.length; i++) {
                        //console.log(json.items[i].displayName, json.items[i].ip, json.items[i].product);
                        devices.push({
                            type: json.items[i].product, place: json.items[i].displayName, ip: json.items[i].ip, status: json.items[i].connectionStatus })
                    }
                    // Return the HTML page via a EJS template
                    res.render("main.ejs", {user: user, org: org, devices: devices});
                });
            });
        });
    });
});    

app.get('/refresh', function (req, res) {
    console.log("Refresh requested");

    // Retrieves the list of the devices - GET https://api.ciscospark.com/v1/devices

    const options = {
        method: 'GET',
        url: 'https://api.ciscospark.com/v1/devices',
        headers: { "authorization": "Bearer " + token }
    };
    request(options, function (error, response, body) {
        if (error) {
            console.log("Auth failure - error: " + error);
            res.redirect('/');
            return;
        }
        // Check if the call is successful
        if (response.statusCode != 200) {
            console.log("Auth failure - error: HTTP " + response.statusCode);
            res.redirect("/");
            return;
        }
        // json is an array
        const json = JSON.parse(body);
        var devices = [];
        var i;
        for (i = 0; i < json.items.length; i++) {
            //console.log(json.items[i].displayName, json.items[i].ip, json.items[i].product);
            devices.push({
                type: json.items[i].product, place: json.items[i].displayName, ip: json.items[i].ip, status: json.items[i].connectionStatus
            })
        }
        // Return the HTML page via a EJS template
        res.render("main.ejs", {user: user, org: org, devices: devices});
    });
});    

// displays the form for the migration (data collection)
app.get("/migrateForm", function (req, res) {
    console.log("Migrate requested");
    // Return the HTML page via a EJS template
    if (token === undefined) {
        res.redirect('/');
    }
    else {
        res.render("migrate-form.ejs", {user: user, org: org});
    }
});

// loads the migration data in the global variables and displays the table
app.post('/migrateTable', function(req, res){
    console.log('Load migration data and display the table');
    //console.log(req.body);
    const file = req.body.file;
    username = req.body.user;
    password = req.body.password;
    disableAdmin = req.body.disableAdmin;  // true/false
    // process the data
    const data = file.replace(/(\r\n|\n|\r)/gm, ";");
    const arrayDevices = data.split(';');
    // Structure of arrayDevices: two entries per record, num of rows = lenght/2
    // Moving the data moved in 2 arrays, ipAddress and placeName
    var fieldType = 'ip';
    var ipAddress = [];
    var placeName = [];
    // empty the endpoints array first
    endpoints = [];
    for (let i=0; i<arrayDevices.length; i++) {
        if (fieldType == 'ip') {
            ipAddress.push(arrayDevices[i]);
            fieldType = 'place';
        }
        else {
            placeName.push(arrayDevices[i]);
            fieldType = 'ip'
        };
    };
    // loads (and initialise) the global variable ENDPOINTS that feeds the migration table
    for (let i = 0; i < ipAddress.length; i++) {
        endpoints.push({
            id: i, ip: ipAddress[i], place: placeName[i], status: '0', statusDesc: 'Click to migrate...'
        })
    }
    //console.log(endpoints);
    // serves the main section of the page (migrate table)
    res.render("migrate.ejs", { user: user, org: org, endpoints: endpoints });
});

// starts the migration of the requested endpoint (from the migrate button in the migration table)
app.post('/migrate', function (req, res) {
    var id = req.body.id;
    console.log('Migrate endpoint with id: ' + id);
    // endpoint migration step 1: connect to the endpoint
    //  - to avoid creating a place if the endpoint is not reachable and 'OK'
    var xapi = jsxapi.connect('ssh://' + endpoints[id].ip, { username: username, password: password});
    //handler for any errors encountered with jsxapi
    xapi.on('error', (err) => {  
        console.error('ERROR: connection to the endpoint failed: ${err}');
        endpoints[id].status = 2;
        endpoints[id].statusDesc = 'ERROR: cannot connect to the endpoint.';
        res.status(200);
        // Note: the IP address is used to identify the description <td> element
        res.end(JSON.stringify({ id: id, ip: endpoints[id].ip, status: endpoints[id].statusDesc }));
    });
    if (endpoints[id].status == 0) {

        // migration step 2: create the place
        var url = 'https://api.ciscospark.com/v1/places';
        var data = { displayName: endpoints[id].place, type: 'room_device' };
        const params = {
            method: 'POST',
            url: url,
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json', 'authorization': 'Bearer ' + token }};
        request(params, function (error, response, body) {
            if (error || response.statusCode != 200) {
                console.log("Error creating the place!");
                endpoints[id].status = 3;
                endpoints[id].statusDesc = 'ERROR: cannot create the Place. Check the entitlement.';
                res.status(200);
                // Note: the IP address is used to identify the description <td> element
                res.end(JSON.stringify({ id: id, ip: endpoints[id].ip, status: endpoints[id].statusDesc }));
            }
            else {
                const json = JSON.parse(body);
                var place = json.id;
                console.log('Place created: ' + place);

                // migration step 3: create the code
                var url = 'https://api.ciscospark.com/v1/devices/activationCode';
                var data = { placeId: place };
                const params = {
                    method: 'POST',
                    url: url,
                    body: JSON.stringify(data),
                    headers: { 'Content-Type': 'application/json', 'authorization': 'Bearer ' + token }
                };
                request(params, function (error, response, body) {
                    if (error || response.statusCode != 200) {
                        console.log("Error creating the activation code!");
                        endpoints[id].status = 4;
                        endpoints[id].statusDesc = 'ERROR: cannot create the activation code. Check the entitlement.';
                        res.status(200);
                        // Note: the IP address is used to identify the description <td> element
                        res.end(JSON.stringify({ id: id, ip: endpoints[id].ip, status: endpoints[id].statusDesc }));
                    }
                    else {
                        const json = JSON.parse(body);
                        var code = json.code;
                        console.log('Code created: ' + code);

                        // migration step 4: sending the activation code to the endpoint
                        let option = 'NoAction';
                        if (disableAdmin) {
                            option = 'Harden'
                        }
                        // To replace with Request in order to get the response
                        xapi.command('Webex Registration Start', { ActivationCode: code, SecurityAction: option });
                        // assuming the migration command has completed 
                        endpoints[id].status = 1;
                        endpoints[id].statusDesc = 'Migration of the endpoint completed succesfully.';
                        // sends the response to the client
                        res.status(200);
                        // Note: the IP address is used to identify the description <td> element
                        res.end(JSON.stringify({ id: id, ip: endpoints[id].ip, status: endpoints[id].statusDesc }));
                    }



                });




            }
        });
    };
});

// shows a 404 error if no other routes are matched
// note: default path for .ejs files is /views
app.use(function(req, res) {
    res.status(404).render('404.ejs');
});

// === F U N C T I O N S ===

function getLogoutURL(token, redirectURL) {
  const rootURL = redirectURL.substring(0, redirectURL.length - 5);
  return (
    "https://idbroker.webex.com/idb/oauth2/v1/logout?" +
    "goto=" +
    encodeURIComponent(rootURL) +
    "&token=" +
    token
  );
}


// Starts the Express HTTP server

app.listen(port, () => console.log("HTTP Server (Express) listening on port: " + port));