/**
 * Wrapper around playmusic
 */

'use strict';

const PlayMusic = require('playmusic');

class Pm {

	constructor() {

		this.pm = new PlayMusic();

		['init', 'login', 'search', 'getPlayLists', 'getPlayListEntries', 'addPlayList', 'removePlayListEntry', 'addTrackToPlayList', 'updatePlayListMeta']
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

}

module.exports = new Pm();
