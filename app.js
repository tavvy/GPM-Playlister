
'use strict';

const fetch = require('node-fetch');
const chalk = require('chalk');
const cheerio = require('cheerio');
const path = require('path');
const readlineSync = require('readline-sync');

const readJson = require('./lib/read-json');
const fuzzyRegex = require('./lib/fuzzy-regex');
const reporter = require('./lib/reporter');
const PM = require('./lib/pm');
const utils = require('./lib/utils');

const schema = require('./config/schema');
const presetStations = require('./config/stations');
const authPath = path.join(__dirname, './config/auth-token.json');

module.exports = init;

/**
 * APP ENTRY POINT
 * configure settings, load required files and auth data. validate and kick of generation
 * @param {Object} - cliArgs
 *	{
 *		url: {String} either url or null
 *		station: {String} either key name to find in presetStations or null
 *		guided: {Boolean} allow user to help match
 *		replaceExisting: {Boolean} replace existing GPM playlist if there is a match
 *	}
 */
function init(cliArgs) {
	// set up generate options
	const options = {
		url: cliArgs.station ? presetStations[cliArgs.station] : cliArgs.url,
		schema: cliArgs.station ? schema.bbc_station : schema.bbc_playlister,
		guided: cliArgs.guided || false,
		replaceExisting: cliArgs.replaceExisting || false,
		auth: null
	};

	// check url
	if (!utils.isPlaylisterUrl(options.url)) {
		return reporter.exit(new Error('Not a valid BBC Playlist url'));
	}

	// check auth file
	readJson(authPath)
		.then(data => checkAuth(data))
		.then(res => options.auth = res)
		.then(() => generate(options))
		.catch(err => {
			reporter.exit(new Error('Need to authorise gpm-playlister first, run the login command.\nDetails: ' + err.message));
		});
}
/**
 * CHECK AUTH-TOKEN FILE
 * will validate the auth-token file and its contents
 * @param {Data} - authFileData - the contents of config/auth-token.json
 * @callback {err, Object} - authFileData - the verified androidId and masterToken
 */
function checkAuth(authFileData) {
	return new Promise((resolve, reject) => {
		// issue with contents of file
		if (authFileData.constructor !== Object) {
			return reject(new Error('The contents of auth-token file are corrupt'));
		}
		// check if valid
		if (authFileData && authFileData.androidId && authFileData.masterToken) {
			return resolve(authFileData);
		}
		// invalid credentials
		return reject(new Error('Invalid auth-token'));
	});
}
/**
 * GENERATE
 * generate a GPM playlist from a BBC playlist url
 * @param {Object} - options
 *	{
 *		url: {String} url of playlist
 *		schema: {Object} loaded from config/schema.json. contains jQuery style selectors to search htmlString
 *		auth: {Object} loaded from auth-token.json. contains credentials to access GPM
 *		guided: {Boolean} allow user to help match
 *		replaceExisting: {Boolean} replace existing GPM playlist if there is a match
 *	}
 */
function generate(options) {

	reporter.info('Generating a playlist from: ' + options.url + '...');

	// init PlayMusic
	PM.init(options.auth)
		.then(() => fetchPlrTracklist(options))
		.then(plrTracklist => {
			reporter.info(
				'Playlist \"' + plrTracklist.playlist_name + '\" at ' + plrTracklist.playlist_source + ' is ' + plrTracklist.track_list.length + ' tracks long ' +
				'\n\nSearching Google Play Music for matching tracks...'
			);
			return plrTracklist;
		})
		.then(plrTracklist => {
			return fetchGPMStoreIds(plrTracklist.track_list, options)
				.then(matchedTracklist => {
					reporter.info('Finished searching Google Play Music, matched ' + matchedTracklist.matches + ' of ' + matchedTracklist.track_list.length + ' tracks');
					return Object.assign(plrTracklist, matchedTracklist);
				});
		})
		.then(matchedPlrTracklist => {
			reporter.info('\nPushing playlist to Google Play Music...');
			return pushGPMPlaylist(matchedPlrTracklist, options);
		})
		.then(report => reporter.finish(report))
		.catch(err => {
			reporter.exit(new Error('There was a problem connecting to Google Play Music' + '\nDetails: ' + err.message));
		});
}
/**
 * FETCH BBC PLAYLISTER PLAYLIST
 * Grabs html body from given url and performs a transformation on the result
 * @param {Object} options - app options
 */
function fetchPlrTracklist(options) {
	return fetch(options.url)
		.then(res => res.text())
		.then(body => parsePlrTracklist(body, options.url, options.schema))
		.catch(err => {
			err.message = 'There was an error with the content of: ' + options.url + '\nDetails: ' + err.message;
			throw err;
		});
}
/**
 * PARSE BBC PLAYLISTER BODY HTML
 * Builds a Playlister Tracklist given html body as string and a schema to search by
 * @param {String} htmlString - an html body as string
 * @param {Object} schema - contains jQuery style selectors to search htmlString
 * @return {Object} - plrTracklist - contains the playlist name, description and array of tracks containing title and artists
 */
function parsePlrTracklist(htmlString, sourceUrl, schema) {
	const $ = cheerio.load(htmlString);
	const selector = schema;

	let res = {
		playlist_name: $(selector.playlist_name_selector).text().trim() || null,
		playlist_description: `source: ${sourceUrl} (generated by http://www.github.com/tavvy/GPM-Playlister)`,
		playlist_source: sourceUrl,
		track_list: []
	};

	if (selector.playlist_desc_selector === 'meta') {
		res.playlist_description = ($('meta[name=description]').attr('content').trim() || null) + ' | ' + res.playlist_description;
	} else {
		res.playlist_description = ($(selector.playlist_desc_selector).text().trim() || null) + ' | ' + res.playlist_description;
	}

	$(selector.track_selector, selector.tracklist_selector).each(function(i, el) {
		const track_artist = $(selector.artist_selector, el).text().trim() || $(selector.alt_artist_selector, el).text().trim() || null;
		const track_title = $(selector.title_selector, el).text().trim() || null;
		res.track_list.push({
			title: track_title,
			artist: track_artist
		});
	});

	return res;
}
/**
 * CREATE GPM STORE ID ARRAY
 * Search GPM for tracks in Playlister Tracklist and save the match's GPM-Store-ID to array
 * @param {Array} trackList - an array of objects containing track title and artists
 * @param {Object} options - app options
 * @callback {err, Array} - storeIds - an array of GPM-Store-IDs
 */
function fetchGPMStoreIds(trackList, options) {
	var response = {
		track_list: trackList,
		matches: 0
	};

	const searches = response.track_list.map(track => {
		return PM.search(`${track.artist} ${track.title}`, 5)
			.then(results => {
				if (results.entries) {
					track.results = results.entries;
				}
				return track;
			});
	});

	return Promise.all(searches)
			.then(tracks => {
				const matches = tracks.map(t => {
					return matchTrackResult(t, options)
						.then(match => {
							if (match.storeId) {
								response.matches++;
								t.gpmStoreId = match.storeId;
							} else {
								reporter.match(null, t);
							}
							return t;
						});
				});
				return Promise.all(matches);
			})
			.then(res => {
				response.track_list = res;
				return response;
			});
}
/**
 * FIND A MATCHING TRACK IN A LIST OF RESULTS
 * Find a matching track in a list of GPM search results
 * @param {Object} track - contains the title and artist of the track to find
 * @param {Array} track.results - an array of GPM search results containing track title and artists
 * @param {Object} options - app options
 * @resolve {Object} - match - contains match data, type and its GPM-Store-ID
 */

function matchTrackResult(track, options) {

	let match = {
		data: null,
		matchType: 0,
		storeId: 0
	};

	if (!track.results) {
		return Promise.resolve(track);
	}

	// try and find a matching result
	track.results.forEach(function(item) {
		// if its a valid song and we havnt found a match yet
		if (!match.data && validateGPMSongResult(item, track)) {

			if (item.track.title.toUpperCase() === track.title.toUpperCase()) {
				// exact title match
				match.data = item;
				match.matchType = 1;
				match.storeId = item.track.storeId;
			} else if (fuzzyMatchTitle(item, track)) {
				// fuzzy title match
				match.data = item;
				match.matchType = 2;
				match.storeId = item.track.storeId;
			}

		}
	});

	// ask user for help
	if (!match.data && options.guided) {
		userMatch(track.results, track, function(item) {
			if (item) {
				// user match
				match.data = item;
				match.matchType = 3;
				match.storeId = item.track.storeId;
			}
		});
	}

	// report the match
	reporter.match(match.matchType, track, match.data);

	return Promise.resolve(match);

}
/**
 * VALIDATE GPM SONG
 * check that the result is a valid song. if query is passed, will also validate that the artists match
 * @param {Object} result - GPM search result
 * @param {Object} [optional] query - contains the title and artist of the track to find
 * @return {Boolean} - isValid - if result is a valid song result (optional: and has a matching artist)
 */
function validateGPMSongResult(result, query) {
	var isValid = false;
	if (result.type === 1 || '1' && result.track && result.track.artist && result.track.title && result.track.storeId) {
		// valid song result
		isValid = true;
	}
	if (isValid && query && result.track.artist.toUpperCase() !== query.artist.toUpperCase()) {
		// invalid artist match
		isValid = false;
	}
	return isValid;
}
/**
 * FUZZY MATCH TITLE
 * will attempt to find a fuzzy title match on the result from query
 * @param {Object} result - GPM search result
 * @param {Object} query - contains the title and artist of the track to find
 * @return {Boolean} - isMatch - if title is a fuzzy match
 */
function fuzzyMatchTitle(result, query) {
	return fuzzTitle(result.track.title) === fuzzTitle(query.title);
}
/**
 * FUZZ-IFY A TITLE
 * will perfom some basic transformations on a string to help fuzzy match
 * @param {String} title - the title
 * @return {String} fuzzyTitle - a fuzz-ified version of the title
 */
function fuzzTitle(title) {
	var fuzzyTitle = title.toUpperCase();
	var phrases = fuzzyRegex;
	phrases.forEach(function(phrase) {
		if (fuzzyTitle.search(phrase.regexp) !== -1) {
			fuzzyTitle = phrase.transform(fuzzyTitle, phrase.regexp);
		}
	});
	return fuzzyTitle;
}
/**
 * USER MATCH
 * will ask the user to pick an item from results that best matches the query
 * @param {Array} results - an array of GPM search results containing track title and artists
 * @param {Object} query - contains the title and artist of the track to find
 * @callback {Object} - match - matched GPM search result
 */
function userMatch(results, query, callback) {
	var mappedResults = {};
	var match = null;


	results.forEach(function(item) {
		if (validateGPMSongResult(item)) {
			var key = item.track.artist + ' - ' + item.track.title;
			mappedResults[key] = item;
		}
	});

	// if we have a results list
	if (Object.keys(mappedResults).length > 0) {

		// use readlineSync to get a user match
		var userAnswerIndex = readlineSync.keyInSelect(Object.keys(mappedResults),
			reporter.info(
				'Possible match. Which of the following is the best match for: ' +
				chalk.bold.underline(query.artist + ' - ' + query.title)
			)
		);

		var answerKey = Object.keys(mappedResults)[userAnswerIndex];
		match = mappedResults[answerKey];
	}

	callback(match);
}
/**
 * PUSH GPM PLAYLIST
 * will push playlist to user GPM library, either creating or replacing an existing match
 * @param {Object} plrTrackList - contains playlist name, description, source and track_list with GPM-Store-IDs
 * @param {Object} options - app options
 * @callback {err, Object} - response - contains pushed playlist data
 */
function pushGPMPlaylist(plrTracklist, options) {
	var response = {
		playlist_id: null,
		playlist_url: null,
		pushed: 0,
		cut: 0,
		type: null,
		new_entries: mapStoreIds(plrTracklist.track_list),
		removed_entries: null
	};

	response = Object.assign(plrTracklist, response);

	return getGPMPlaylistId(response.playlist_name, options)
		.then(res => {
			response = Object.assign(response, res);
			return response;
		})
		.then(response => clearGPMPlaylistEntries(response.playlist_id))
		.then(res => {
			response = Object.assign(response, res);
			return response;
		})
		.then(response => appendGPMPlaylist(response.playlist_id, response.new_entries))
		.then(res => {
			response = Object.assign(response, res);
			return response;
		})
		.then(response => updateGPMPlaylistDescription(response.playlist_id, response.playlist_description))
		.then(res => Object.assign(response, res));

}
/**
 * MAP GPM-STORE-IDS
 * Will first filter and then store tracklist entries with a GPM-Store-ID
 * @param {Array} tl (trackList) - an array of objects containing tracks title, artist and optional GPM-Store-ID
 * @returns {Array} storeIdList - an array of GPM-Store-IDS
 */
function mapStoreIds(tl) {
	return tl.filter(t => t.gpmStoreId).map(t => t.gpmStoreId);
}
/**
 * GET GPM PLAYLIST ID
 * will either replace an existing playlist or create a new one and return its id
 * @param {String} name - the name of the GPM playlist to create or replace
 * @param {Object} options - app options
 * @callback {err, Object} - response - contains playlist id, url and type
 */
function getGPMPlaylistId(name, options) {
	var response = {
		playlist_id: null,
		playlist_url: null,
		type: null
	};


	if (!options.replaceExisting) {
		// create new playlist
		response.type = 0;
		return createGPMPlaylist(name)
			.then(res => Object.assign(response, res));

	} else {

		return PM.getPlayLists().then(playlists => {
			// Replace an existing playlist
			if (playlists && playlists.data && playlists.data.items) {
				playlists.data.items.forEach(function(item) {
					// find 'latest' match
					if (matchGPMPlaylistName(item, name)) {
						response.playlist_id = item.id;
						response.playlist_url = item.shareToken;
					}
				});
			}

			if (response.playlist_id) {
				response.type = 1;
				return response;
			}

			// Nothing to replace, create a new playlist
			response.type = 2;
			return createGPMPlaylist(name)
				.then(res => Object.assign(response, res));

		})
		.catch(err => {
			err.message = 'There was a problem finding Google Play Music Playlists' + '\nDetails: ' + err.message;
			throw err;
		});
	}

}
/**
 * CLEAR GPM PLAYLIST ENTRIES
 * will remove all entries of a given GPM playlist id
 * @param {String} playlistId - the id of the GPM playlist
 * @callback {err, Object} - response - contains removed entry ids and how many were cut
 */
function clearGPMPlaylistEntries(playlistId) {
	var response = {
		cut: null,
		removed_entries: []
	};

	return PM.getPlayListEntries()
		.then(result => {

			if (result && result.data && result.data.items) {
				result.data.items.forEach(function(item) {
					if (item.playlistId === playlistId) {
						response.removed_entries.push(item.id);
					}
				});
			}

			if (response.removed_entries.length === 0) {
				return response;
			}

			return cutGPMPlaylistEntry(response.removed_entries)
				.then(result => {
					response = Object.assign(response, result);
					return response;
				})
				.catch(err => {
					throw err;
				});

		})
		.then(res => res)
		.catch(err => {
			err.message = 'There was a problem emptying the existing Google Play Music Playlist' + '\nDetails: ' + err.message;
			throw err;
		});

}
/**
 * CREATE GPM PLAYLIST
 * create a new GPM Playlist with a given name
 * @param {String} name - the name of the GPM playlist to create
 * @callback {err, Object} - result - contains new playlist id, url
 */
function createGPMPlaylist(name) {
	var result = {
		playlist_id: null,
		playlist_url: null
	};


	return PM.addPlayList(name)
		.then(response => {
			// map the response from: {mutate_response: [{id:val}]}
			result.playlist_id = response.mutate_response[0].id || null;

			return getPlaylistUrl(result.playlist_id)
				.then(url => {
					result.playlist_url = url;
					return result;
				});
		})
		.catch(err => {
			err.message = 'There was a problem creating a Google Play Music Playlist' + '\nDetails: ' + err.message;
			throw err;
		});
}
/**
 * DELETE GPM PLAYLIST ENTRIES BY ID
 * will delete all given GPM playlist entry ids
 * @param {Array} playlistEntries - GPM playlist entry ids
 * @callback {err, Object} - response - how many entries were deleted
 */
function cutGPMPlaylistEntry(playlistEntries) {
	const response = {cut: playlistEntries.length};

	return PM.removePlayListEntry(playlistEntries)
			.then(() => response)
			.catch(err => {
				err.message = 'There was a problem removing tracks from a Google Play Music playlist' + '\nDetails: ' + err.message;
				throw err;
			});
}
/**
 * ADD TRACKS TO A GPM PLAYLIST
 * will add tracks by GPM-Store-ID to a given GPM Playlist
 * @param {String} playlistId - the ID of the GPM playlist
 * @param {Array} storeIdList - GPM-Store-IDs
 * @param {Object} options - app options
 * @callback {err, Object} - response - how many tracks were added
 */
function appendGPMPlaylist(playlistId, storeIdList) {
	var result = {
		pushed: storeIdList.length
	};

	return PM.addTrackToPlayList(storeIdList, playlistId)
		.then(() => result)
		.catch(err => {
			err.message = 'There was a problem adding tracks to Google Play Music playlist' + '\nDetails: ' + err.message;
			throw err;
		});
}
/**
 * GET A GPM PLAYLIST URL
 * get a GPM playlists' url given its ID
 * @param {String} playlistId - the ID of the GPM playlist
 * @callback {String} - result - the url or null
 */
function getPlaylistUrl(playlistId) {
	var url = null;

	return PM.getPlayLists().then(playlists => {
		// find match
		if (playlists && playlists.data && playlists.data.items) {
			playlists.data.items.forEach(function(item) {
				if (item.id === playlistId) {
					url = item.shareToken || null;
				}
			});
		}
		return url;
	})
	.catch(err => {
		reporter.warn('There was a problem finding Google Play Music Playlists' + '\nDetails: ' + err.message);
		return url;
	});
}
/**
 * UPDATE A GPM PLAYLIST DESCRIPTION
 * update a GPM playlists' description given its ID
 * @param {String} playlistId - the ID of the GPM playlist
 * @param {String} - description - the description
 * @callback {Object} - response - contains the playlist description
 */
function updateGPMPlaylistDescription(playlistId, description) {
	var response = {
		playlist_description: description
	};
	var updates = {
		description: description
	};

	return PM.updatePlayListMeta(playlistId, updates)
		.then(() => response)
		.catch(err => {
			reporter.warn('Could not update the Google Play Music playlist description' + '\nDetails: ' + err.message);
			response.playlist_description = null;
			return response;
		});
}
/**
 * MATCH AND VALIDATE A GPM PLAYLIST
 * validate and check GPM playlist matches given name
 * @param {Object} playlist - contains GPM playlist data
 * @param {String} name - playlist name to find
 * @returns {Boolean} - isMatch - if playlist is a match
 */
function matchGPMPlaylistName(playlist, name) {
	var isMatch = false;
	if (playlist.deleted === false && playlist.name === name && playlist.type === 'USER_GENERATED') {
		isMatch = true;
	}
	return isMatch;
	// playlist.accessControlled === true means its shared
}
