# WX Migrator
WX Migrator has been built to demo the use of Webex devices/places API and in particular to show how these new APIs can be used to easily and remotely migrate on-prem video endpoints to Webex.

Leveraging the Webex authentication, the tool resembles the Control Hub's devices page: it lists all the devices in the org (admin access is required).

From there it allows to simply create an activation code in one click and also to start the on-prem migration providing the list of on-prem registered endpoints via a .CSV file.

Please see the examples provided in the repo for the format of the .CSV file.

# Version
Webex Migrator version 3.0 (Sept 25th 2019)

# Requirements
Node.js with the following libraries: 
- express & ejs
- request
- path
- jsdom

# How To

Since Sept 25th the server runs on 10.58.9.150 so you can try it simply by connecting to: http://10.58.9.150:8080 (Cisco internal only).

Alternatively you can run the code on your own nodeJS server; here are the required steps:

1) (preliminary) create a Webex integration for the app at https://developer.webex.com/my-apps/new with the following scopes: spark:people_read, spark-admin:devices_write, spark-admin:organizations_read, spark-admin:places_write and identity:placeonetimepassword_create.

2) update the code with your integration's id, secret and your server IP address (lines 13 - 19)
 
1) Install node.js and the required libraries

2) run: node migrator.js

3) browse at http://<your_server_IP>:8080

Enjoy!

# Please read

- The current built is beta code, meant to demonstrate the capability. Error handling is not complete yet.
- for the format of the CSV file for endpoint migration please see the sample .CSV provided in this repository.




