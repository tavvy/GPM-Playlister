/**
 * Wrapper around playmusic
 */

'use strict';

const PlayMusic = require('playmusic');

class Pm {

	constructor() {

		this.pm = new PlayMusic();

		// NOTE! for song search results we need to add &ct=1
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

	getPlayListEntriesRecursive (existingResults, nextPageToken) {
		let results = existingResults && existingResults.length > 0 ? existingResults : [];

		return this.getPlayListEntries({ limit: 10000, nextPageToken })
			.then(res => {
				if (res && res.data && res.data.items) {
					results = results.concat(res.data.items);
				}

				if (res.nextPageToken) {
					return this.getPlayListEntriesRecursive(results, res.nextPageToken);
				}

				return results;
			});
	}

}

module.exports = new Pm();
