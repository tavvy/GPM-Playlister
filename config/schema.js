
'use strict';

var schema = {
	bbc_playlister: {
		urlRegex: '',
		tracklist_selector: 'ul.plr-playlist-trackslist',
		track_selector: 'li.plr-playlist-trackslist-track',
		artist_selector: '.plr-playlist-trackslist-track-name-artistlink',
		alt_artist_selector: '.plr-playlist-trackslist-track-name-artist',
		title_selector: '.plr-playlist-trackslist-track-name-title'
	},
	bbc_station: {
		urlRegex: '',
		tracklist_selector: 'div.pll-content',
		track_selector: 'div.pll-playlist-item',
		artist_selector: 'div.pll-playlist-item-artist a',
		alt_artist_selector: 'div.pll-playlist-item-artist',
		title_selector: 'div.pll-playlist-item-title'
	}
};


module.exports = schema;
