'use strict';

module.exports = {
	bbc_playlister: {
		tracklist_selector: 'ul.plr-playlist-trackslist',
		track_selector: 'li.plr-playlist-trackslist-track',
		artist_selector: '.plr-playlist-trackslist-track-name-artistlink',
		alt_artist_selector: '.plr-playlist-trackslist-track-name-artist',
		title_selector: '.plr-playlist-trackslist-track-name-title',
		playlist_name_selector: 'h1.plr-playlist-header-title',
		playlist_desc_selector: 'p.plr-playlist-description'
	},
	bbc_station: {
		tracklist_selector: 'div.pll-content',
		track_selector: 'div.pll-playlist-item',
		artist_selector: 'div.pll-playlist-item-artist a',
		alt_artist_selector: 'div.pll-playlist-item-artist',
		title_selector: 'div.pll-playlist-item-title',
		playlist_name_selector: 'div.pll-header',
		playlist_desc_selector: 'meta'
	}
};
