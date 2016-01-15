
'use strict';

var fs = require('fs');
var path = require('path');
var chalk = require('chalk');
var PlayMusic = require('playmusic');

module.exports = login;

var pm = new PlayMusic();

function login(username, password) {

	pm.login({
		email: username,
		password: password
	}, function(err, resp) {
		if (err) {
			return console.log(err);
		}
		if (resp.androidId && resp.masterToken) {
			fs.writeFileSync(path.join(__dirname, '..', 'config/user-data.json'), JSON.stringify(resp));
			console.log(chalk.green('Successfully logged into google play music as: ' + username));
		}
	});

}

// function logout() {
// 	fs.writeFileSync(path.join(__dirname, '..', 'config/user-data.json'), '{}');
// }
