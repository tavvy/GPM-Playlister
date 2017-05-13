
'use strict';

const jsonfile = require('jsonfile');
const path = require('path');
const authPath = path.join(__dirname, '..', 'config/auth-token.json');
const reporter = require('./reporter');
const utils = require('./utils');
const PM = require('./pm');

/**
 * LOGIN
 * will attempt to login to GPM via PlayMusic and store the successful mock android credentials
 * @param {String} username - GPM username
 * @param {String} password - GPM password
 */
module.exports = function login(username, password) {

	checkExistingDevice(authPath)
		.then(androidId => PM.login({email: username, password, androidId}))
		.then(resp => {
			if (resp.androidId && resp.masterToken) {
				jsonfile.writeFileSync(authPath, resp);
				reporter.success('Successfully authorised access to Google Play Music as: ' + username);
				process.exit(0);
			}
		})
		.catch(err => {
			reporter.exit(new Error('There was a problem logging into Google Play Music' + '\nDetails: ' + err.message));
		});
};
/**
 * CHECK EXISTING DEVICE
 * return existing androidId saved to the auth file
 * @param {String} authPath - path to file
 * @callback {String} androidId - either the existing androidId or null
 */
function checkExistingDevice(authPath) {
	return utils.readJson(authPath)
		.then(data => {
			let id;
			if (data.constructor === Object && data.androidId && data.masterToken) {
				id = data.androidId;
			}
			return id && id.length === 16 ? id : null;
		});
}

// function logout() {
// 	fs.writeFileSync(userConfigFile, '{}');
// }
