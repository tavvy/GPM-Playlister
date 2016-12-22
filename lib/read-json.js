'use strict';

const jsonfile = require('jsonfile');

module.exports = function readJson(path) {
	return new Promise((resolve, reject) => {
		jsonfile.readFile(path, (err, data) => {
			return err ? reject(err) : resolve(data);
		});
	});
};
