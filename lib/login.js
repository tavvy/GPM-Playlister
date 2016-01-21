
'use strict';

var fs = require('fs');
var path = require('path');
var PlayMusic = require('playmusic');
var reporter = require('./reporter');

var userConfigFile = path.join(__dirname, '..', 'config/user-data.json');

module.exports = login;

var pm = new PlayMusic();

/**
 * LOGIN
 * will attempt to login to GPM via PlayMusic and store the successful mock android credentials
 * @param {String} username - GPM username
 * @param {String} password - GPM password
 */
function login(username, password) {

	pm.login({
		email: username,
		password: password
	}, function(err, resp) {
		if (err) {
			reporter.exit(new Error('There was a problem logging into Google Play Music' + '\nDetails: ' + err.message));
		}
		if (resp.androidId && resp.masterToken) {
			fs.writeFileSync(userConfigFile, JSON.stringify(resp));
			reporter.success('Successfully logged into google play music as: ' + username);
		}
	});

}

// function logout() {
// 	fs.writeFileSync(userConfigFile, '{}');
// }
