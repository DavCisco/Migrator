const express = require('express');
const ejs = require("ejs");
const request = require("request");
const srequest = require('sync-request');
const jsxapi = require('jsxapi');

const read = require("fs").readFileSync;
const join = require("path").join;
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

// Variabili recuperate dalla procedura di Oauth
var token;
var user;
var org;

// Variabili per la migrazione
var ipAddress = [];
var placeName = [];
var placeId = [];
var placeNameCheck = [];
var activationCode = [];
var migrationOutcome = [];


// Step 1: initiate the OAuth flow
//   - serves a Web page with a link to the Webex OAuth flow initializer

app.get("/index.html", function (req, res) {
    console.log('serving the Migrator home page');

    const initiateURL = "https://api.ciscospark.com/v1/authorize?"
        + "client_id=" + clientId
        + "&response_type=code"
        + "&redirect_uri=" + encodeURIComponent(redirectURI)
        + "&scope=" + encodeURIComponent(scopes)
        + "&state=" + state;

    const str = read(join(__dirname, '/www/index.ejs'), 'utf8');
    // inject the link into the template
    const compiled = ejs.compile(str)({ "link": initiateURL });
    res.send(compiled);
});

app.get("/", function (req, res) {
    res.redirect("/index.html");
});


// Step 2: process OAuth on redirect from Webex Oauth

app.get("/oauth", function (req, res) {
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
                    const str = read(join(__dirname, '/www/main.ejs'), 'utf8');
                    const compiled = ejs.compile(str)({ 'user': user, 'org': org, devices: devices });
                    res.send(compiled);
                });
            });
        });
    });
});    


app.get("/refresh", function (req, res) {
    console.log("Refresh requested");

    // Retrieves the list of the devices - GET https://api.ciscospark.com/v1/devices

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
                type: json.items[i].product, place: json.items[i].displayName, ip: json.items[i].ip, status: json.items[i].connectionStatus
            })
        }


        // Return the HTML page via a EJS template
        const str = read(join(__dirname, '/www/main.ejs'), 'utf8');
        const compiled = ejs.compile(str)({ 'user': user, 'org': org, devices: devices });
        res.send(compiled);
    });
});    


app.get("/migrate", function (req, res) {
    console.log("Migrate requested");

    // Retrieves the list of the devices - GET https://api.ciscospark.com/v1/devices

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
                type: json.items[i].product, place: json.items[i].displayName, ip: json.items[i].ip, status: json.items[i].connectionStatus
            })
        }

        // Return the HTML page via a EJS template
        const str = read(join(__dirname, '/www/main-migrate.ejs'), 'utf8');
        const compiled = ejs.compile(str)({ 'user': user, 'org': org, devices: devices });
        res.send(compiled);
    });
});


// Run the migration of the endpoint from the Excel file
app.post('/runMigration', function(req, res){
    console.log('GO with the migration!');
    //console.log(req.body);
    const file = req.body.file;
    const user = req.body.user;
    const pwd = req.body.password;
    // return HTTP 200 to the browser
    res.statusCode = 200;
    res.end("200!");
    // process the data
    const data = file.replace(/(\r\n|\n|\r)/gm, ";");
    const arrayDevices = data.split(';');
    // Structure of arrayDevices: two entries per record, num of rows = lenght/2
    var i;
    var fieldType = 'ip';
    var ipAddress = [];
    var placeName = [];

    for (i=0; i<arrayDevices.length; i++) {
        if (fieldType == 'ip') {
            ipAddress.push(arrayDevices[i]);
            fieldType = 'place';
        }
        else {
            placeName.push(arrayDevices[i]);
            fieldType = 'ip'
        };
    };
    // Data moved in 2 arrays, ipAddress and placeName

    // Now the migration finally starts
    // Data for the migration are in the arrays ipAddress and placeName 
    // and in the variables user, pwd
    // Loops over the endpoints to migrate

    console.log('ipAddress: ' + ipAddress);
    console.log('placeName: ' + placeName);

    var endpoint;

    for (endpoint=1; endpoint<=ipAddress.length; endpoint++) {

        // Step 1/3: create the place
        //      INPUT: place name
        //      OUTPUT: place id -> stored in a new array

        //      POST https://api.ciscospark.com/v1/places

        // sync request
        var url = 'https://api.ciscospark.com/v1/places';
        var body = { displayName: placeName[endpoint-1], type: 'room_device' };
        body = JSON.stringify(body);
        var res = srequest('POST', url, {
            headers: {
                'Content-Type': 'application/json',
                "authorization": "Bearer " + token },  
            body: body
        });
        const newPlaceOutput = JSON.parse(res.getBody('utf8'));

        // stores the newly created place ID
        placeId[endpoint] = newPlaceOutput.id;
        placeNameCheck[endpoint] = newPlaceOutput.displayName;

            // Step 2/3: create the activation code for the place 
            //      INPUT: place id
            //      OUTPUT: code -> stored in a new array

            //      POST https://api.ciscospark.com/v1/devices/activationCode

            // sync request
        url = 'https://api.ciscospark.com/v1/devices/activationCode';
        body = { placeId: placeId[endpoint-1] };
        body = JSON.stringify(body);
        var res = srequest('POST', url, {
            headers: {
                'Content-Type': 'application/json',
                "authorization": "Bearer " + token
            },
            body: body
        });
        const codeOutput = JSON.parse(res.getBody('utf8'));

        // stores the newly created activation code
        // remember that the call are async and run out of order so the normal PUSH would be a disaster!
        activationCode[endpoint] = codeOutput.code;

        //////

        // Step 3/3: send the code to the endpoint
        //      INPUT: IP address, username, password
        //      OUTPUT: return code (OK, KO) -> stored in a new array

        const xapi = jsxapi.connect('ssh://host.example.com', {
            username: 'admin',
            password: 'password',
        });



    }; // end of loop over the endpoints

    console.log('placeId: ' + placeId);
    console.log('placeNameCheck: ' + placeNameCheck);
    console.log('activationCode: ' + activationCode);


}); // end of the full migration task



// Starts the Express HTTP server

app.listen(port, function () {
    console.log("HTTP Server (Express) listening on port: " + port);
});
