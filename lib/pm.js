/**
 * Wrapper around playmusic
 */

'use strict';

const _get = require('lodash.get');
const PlayMusic = require('playmusic');

class Pm {

	constructor() {

		this.pm = new PlayMusic();

		['init', 'login', 'search', 'getPlayLists', 'getPlayListEntries',
		'getSharedPlayListEntries', 'addPlayList', 'removePlayListEntry',
		'addTrackToPlayList', 'updatePlayListMeta']
		.forEach(method => {
			this[method] = function() {
				return new Promise((resolve, reject) => {
					const cb = (err, res) => err ? reject(err) : resolve(res);
					return arguments ?
						this.pm[method].call(this.pm, ...arguments, cb) :
						this.pm[method].call(this.pm, cb);
				});
			};
		});

	}

	getPlayListEntriesRecursive (results=[], nextPageToken) {
		return this.getPlayListEntries({ limit: 10000, nextPageToken })
			.then(res => {
				results = results.concat(_get(res, 'data.items', []));

				return res.nextPageToken
					? this.getPlayListEntriesRecursive(results, res.nextPageToken)
					: results;
			});
	}

}

module.exports = new Pm();
