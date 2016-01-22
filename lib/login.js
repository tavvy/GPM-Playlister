
'use strict';

var jsonfile = require('jsonfile');
var path = require('path');
var PlayMusic = require('playmusic');

var authPath = path.join(__dirname, '..', 'config/auth-token.json');
var reporter = require('./reporter');

module.exports = login;

var pm = new PlayMusic();

/**
 * LOGIN
 * will attempt to login to GPM via PlayMusic and store the successful mock android credentials
 * @param {String} username - GPM username
 * @param {String} password - GPM password
 */
function login(username, password) {
	checkExistingDevice(authPath, function(androidId) {
		pm.login({
			email: username,
			password: password,
			androidId: androidId
		}, function(err, resp) {
			if (err) {
				reporter.exit(new Error('There was a problem logging into Google Play Music' + '\nDetails: ' + err.message));
			}
			if (resp.androidId && resp.masterToken) {
				jsonfile.writeFileSync(authPath, resp);
				reporter.success('Successfully authorised access to Google Play Music as: ' + username);
				process.exit(0);
			}
		});
	});
}
/**
 * CHECK EXISTING DEVICE
 * return existing androidId saved to the auth file
 * @param {String} authPath - path to file
 * @callback {String} androidId - either the existing androidId or null
 */
function checkExistingDevice(authPath, callback) {
	var androidId = null;
	jsonfile.readFile(authPath, function(error, data) {
		if (!error) {
			// check if valid
			if (data.constructor === Object && data.androidId && data.masterToken) {
				androidId = data.androidId.length === 16 ? data.androidId : null;
			}
		}
		callback(androidId);
	});
}

// function logout() {
// 	fs.writeFileSync(userConfigFile, '{}');
// }
