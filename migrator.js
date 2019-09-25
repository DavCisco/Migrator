//
// Copyright (c) 2019 Cisco Systems
// Licensed under the MIT License 
//

const express = require('express');
const request = require("request");
const path = require('path');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;

// Webex integration details
const clientId = 'C00f24cafd10fcdaacd19edc9cb8da5a673808430778c3ee4d0fb8d24781bd8ed';
const clientSecret = '6229fcb498fab55778387a316cbe54ea421f45c25fb6ece9746e2a39b5f152e1';
// the scopes separator is a space, example: "spark:people_read spark:rooms_read"
// Note: spark:kms is added by default in the integration definition
const scopes = 'spark:kms spark:all spark-admin:devices_write spark-admin:places_write spark-admin:organizations_read identity:placeonetimepassword_create';
const port = '8080';
const redirectURI = `http://10.58.9.150:${port}/oauth`;
const state = 'Challenge';  // not used

const app = express();
// path to serve static content (css & js) for EJS templates
app.use(express.static(path.join(__dirname, 'www/assets')));
// to support URL-encoded bodies by the client (for POST) 
app.use(express.urlencoded({extended: true}));

// for the output of the Oauth procedure
var token, user, org;

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

// Starts the OAuth flow
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

// Process OAuth on redirect from Webex
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

// Refresh the devices (CH like) view
app.get('/refresh', function (req, res) {
    console.log("Refresh requested");
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

// Displays the form for the migration (data collection)
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

// Loads the migration data in the global variables and displays the table
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

    // Migration error table (stored in endpoint[i].status)
    // 0 initial value (no error yet)
    // 1 migration completed succesfully
    // 21 endpoint connection issue: cannot reach
    // 22 endpoint connection issue: HTTP != 200
    // 31
    // 
    endpoints[id].status = 0;

    // endpoint migration step 1: connect to the endpoint
    //  - to avoid creating a place if the endpoint is not reachable and 'OK'
    var url = 'http://' + endpoints[id].ip + '/getxml?location=/Status/SystemUnit/ProductId';
    let buff = Buffer.from(username + ':' + password);
    let auth = 'Basic ' + buff.toString('base64');
    var params = {
        method: 'GET',
        url: url,
        headers: { 'authorization': auth },
        timeout: 10000  // changing the connect timeout from the default (120000 = 2 mins)
    };
    request(params, function(error, response, body) {
        if (error) {
            //error connecting to the endpoint
            console.log('ERROR checking connectivity to the endpoint: ' + error);
            endpoints[id].status = 21;
            endpoints[id].statusDesc = 'ERROR testing connectivity to the endpoint: ' + error;
            // Note: the IP address is used to identify the description <td> element
            res.end(JSON.stringify({ id: id, ip: endpoints[id].ip, status: endpoints[id].statusDesc }));
            return;
        }
        if (response.statusCode!=200) {
            // error on the endpoint
            console.log('ERROR from the endpoint: HTTP ' + response.statusCode);
            endpoints[id].status = 22;
            endpoints[id].statusDesc = 'ERROR: ' + response.body;
            // Note: the IP address is used to identify the description <td> element
            res.end(JSON.stringify({ id: id, ip: endpoints[id].ip, status: endpoints[id].statusDesc }));
            return;
        }
        // saves for later the endpoint productId
        const dom = new JSDOM(response.body);
        const product = dom.window.document.querySelector('ProductId').textContent;
        
        // migration step 2: create the place
        var url = 'https://api.ciscospark.com/v1/places';
        var data = { displayName: endpoints[id].place, type: 'room_device' };
        params = {
            method: 'POST',
            url: url,
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json', 'authorization': 'Bearer ' + token }
        };
        request(params, function (error, response, body) {
            if (error) {
                console.log("ERROR connecting to Webex to create the place!");
                endpoints[id].status = 31;
                endpoints[id].statusDesc = 'ERROR: cannot connect to Webex to create the Place.';
                // Note: the IP address is used to identify the description <td> element
                res.end(JSON.stringify({ id: id, ip: endpoints[id].ip, status: endpoints[id].statusDesc }));
                return;
            }
            if (response.statusCode != 200) {
                console.log("ERROR creating the place!");
                endpoints[id].status = 32;
                endpoints[id].statusDesc = 'ERROR: cannot create the place. ' + response.body;
                // Note: the IP address is used to identify the description <td> element
                res.end(JSON.stringify({ id: id, ip: endpoints[id].ip, status: endpoints[id].statusDesc }));
                return;
            }
            var place = JSON.parse(body).id;
            console.log('Place created, ID: ' + place);

            // migration step 3: create the code
            var url = 'https://api.ciscospark.com/v1/devices/activationCode';
            var data = { placeId: place };
            params = {
                method: 'POST',
                url: url,
                body: JSON.stringify(data),
                headers: { 'Content-Type': 'application/json', 'authorization': 'Bearer ' + token }
            };
            request(params, function (error, response, body) {
                if (error) {
                    console.log("ERROR connecting to Webex to create the code!");
                    endpoints[id].status = 41;
                    endpoints[id].statusDesc = 'ERROR: cannot connect to Webex to create the activation code.';
                    // Note: the IP address is used to identify the description <td> element
                    res.end(JSON.stringify({ id: id, ip: endpoints[id].ip, status: endpoints[id].statusDesc }));
                    return;
                }
                if (response.statusCode != 200) {
                    console.log("ERROR creating the activation code!");
                    endpoints[id].status = 42;
                    endpoints[id].statusDesc = 'ERROR: cannot create the activation code. ' + response.body;
                    // Note: the IP address is used to identify the description <td> element
                    res.end(JSON.stringify({ id: id, ip: endpoints[id].ip, status: endpoints[id].statusDesc }));
                    return;
                }
                var code = JSON.parse(body).code;
                console.log('Code created: ' + code);

                // migration step 4: sending the activation code to the endpoint
                let option = 'NoAction';
                if (disableAdmin) {option = 'Harden'};
                // sample
                //var data = '<Command><Webex><Registration><Start><ActivationCode>12345678</ActivationCode><SecurityAction>NoAction</SecurityAction></Start></Registration></Webex></Command>';
                var data = '<Command><Webex><Registration><Start>';
                data += '<ActivationCode>' + code + '</ActivationCode>';
                data += '<SecurityAction>' + option + '</SecurityAction>';
                data += '</Start></Registration></Webex></Command>';
                var url = 'http://' + endpoints[id].ip + '/putxml';
                params = {
                    method: 'POST',
                    url: url,
                    body: data,
                    timeout: 10000,  // changing the connect timeout from the default (120000 = 2 mins)
                    headers: { 'Content-Type': 'text/xml', 'authorization': auth }};
                    request(params, function (error, response, body) {
                    if (error) {
                        //error connecting to the endpoint
                        console.log('ERROR connecting to the endpoint: ' + error);
                        endpoints[id].status = 51;
                        endpoints[id].statusDesc = 'ERROR: cannot reach to the endpoint. Check connectivity.';
                        // Note: the IP address is used to identify the description <td> element
                        res.end(JSON.stringify({ id: id, ip: endpoints[id].ip, status: endpoints[id].statusDesc }));
                        return;
                    }
                    if (response.statusCode != 200) {
                        // error on the endpoint
                        console.log('ERROR from the endpoint: HTTP ' + response.statusCode);
                        endpoints[id].status = 52;
                        endpoints[id].statusDesc = 'ERROR: ' + response.body;
                        // Note: the IP address is used to identify the description <td> element
                        res.end(JSON.stringify({ id: id, ip: endpoints[id].ip, status: endpoints[id].statusDesc }));
                        return;
                    }
                    // parses the response
                    //    check if it contains the tag <Reason>  -> means that it was KO
                    console.log('Migration command output: ' + response.body);
                        if (response.body.includes('status="OK"')) {
                            // migration OK!!!
                            endpoints[id].statusDesc = product + ': migration completed successfully!';
                            // Note: the IP address is used to identify the description <td> element
                            res.end(JSON.stringify({ id: id, ip: endpoints[id].ip, status: endpoints[id].statusDesc }));
                        }
                        else if (response.body.includes('<Reason>')) {
                            // migration  KO with a reason
                            const dom = new JSDOM(response.body);
                            const reason = dom.window.document.querySelector('Reason').textContent;
                            endpoints[id].statusDesc = 'Migration not complete, reason: ' + reason;
                            // Note: the IP address is used to identify the description <td> element
                            res.end(JSON.stringify({ id: id, ip: endpoints[id].ip, status: endpoints[id].statusDesc }));
                        }
                        else {
                            // migration KO with no reason found
                            endpoints[id].statusDesc = 'Migration not complete due to an unknown reason.';
                            // Note: the IP address is used to identify the description <td> element
                            res.end(JSON.stringify({ id: id, ip: endpoints[id].ip, status: endpoints[id].statusDesc }));
                        }
                });
            });
        });
    });
});

// starts the migration of the requested endpoint (from the migrate button in the migration table)
app.post('/addDevice', function (req, res) {
    console.log('Add device requested');
    var place = req.body.place;
    console.log('Place: ' + place);
    // step 1: creation of the place
    var url = 'https://api.ciscospark.com/v1/places';
    var data = { displayName: place, type: 'room_device'};
    params = {
        method: 'POST',
        url: url,
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json', 'authorization': 'Bearer ' + token }
    };
    request(params, function (error, response, body) {
        if (error) {
            console.log("Auth failure - error: " + error);
            res.redirect('/');
            return;
        }
        if (response.statusCode != 200) {
            console.log('ERROR: cannot create the place. ' + response.body);
            //res.end(JSON.stringify({ id: id, ip: endpoints[id].ip, status: endpoints[id].statusDesc }));
            return;
        }
        var placeId = JSON.parse(body).id;
        console.log('Place created, ID: ' + placeId);

        // step 2: creates the activation code
        var url = 'https://api.ciscospark.com/v1/devices/activationCode';
        var data = { placeId: placeId };
        params = {
            method: 'POST',
            url: url,
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json', 'authorization': 'Bearer ' + token }
        };
        request(params, function (error, response, body) {
            if (error) {
                console.log("ERROR connecting to Webex to create the code!");
                //endpoints[id].statusDesc = 'ERROR: cannot connect to Webex to create the activation code.';
                //res.end(JSON.stringify({ id: id, ip: endpoints[id].ip, status: endpoints[id].statusDesc }));
                return;
            }
            if (response.statusCode != 200) {
                console.log("ERROR creating the activation code!");
                //endpoints[id].statusDesc = 'ERROR: cannot create the activation code. ' + response.body;
                //res.end(JSON.stringify({ id: id, ip: endpoints[id].ip, status: endpoints[id].statusDesc }));
                return;
            }
            var code = JSON.parse(body).code;
            console.log('Code created: ' + code);
            res.end(JSON.stringify({ code: code }));
        });
    });
});

app.get('/checkPlaces/:confirmed', function (req, res) {
    // will be used later
    var confirmed = req.params.confirmed;
    console.log('Remove empty places requested');
    // first gets the list of the places associated to the devices
    // secondly, cancel all places that don't match
    let options = {
        method: 'GET',
        url: 'https://api.ciscospark.com/v1/devices',
        headers: { "authorization": "Bearer " + token }
    };
    request(options, function (error, response, body) {
        if (error) {
            console.log("could not reach Webex API to retrieve the device list, error: " + error);
            res.redirect('/');
            return;
        }
        // Check if the call is successful
        if (response.statusCode != 200) {
            console.log("could not retrieve the device list, devices returned: " + response.statusCode);
            res.redirect('/');
            return;
        }
        let json = JSON.parse(body);
        const nbrPlacesInUse = json.items.length;
        var placesInUse = [];
        for (let i = 0; i < json.items.length; i++) {
            placesInUse.push(json.items[i].placeId)
        }
        options = {
            method: 'GET',
            url: 'https://api.ciscospark.com/v1/places?max=1000',
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
                res.redirect('/');
                return;
            }
            json = JSON.parse(body);
            const nbrPlaces = json.items.length;
            var places = [];
            for (let i = 0; i < json.items.length; i++) {
                places.push(json.items[i].id);
            }
            
            confirmed = 'n';
            
            // if to be confirmed
            if (confirmed == 'n') {
                console.log('There are ' + nbrPlacesInUse + ' places in use out of ' + nbrPlaces);
                console.log('Requesting confirmation');
                res.end(JSON.stringify({ placesInUse: nbrPlacesInUse, places: nbrPlaces }));

            }
            else {
                for (let i = 0; i < nbrPlaces; i++) {
                    //console.log('#' + i + ':' + places[i]);
                    if (!placesInUse.includes(places[i])) {
                        console.log('Place to delete: ' + i);
                        deletePlace(places[i]);
                    };
                };

            };

            


            

            res.end();
        });
    });
});

// shows a 404 error if no other routes are matched
app.use(function(req, res) {
    res.status(404).render('404.ejs');
});

// === F U N C T I O N S ===

function deletePlace(place) {
    console.log(place)
};

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