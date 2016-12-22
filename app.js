
'use strict';

const async = require('async');
const fetch = require('node-fetch');
const chalk = require('chalk');
const cheerio = require('cheerio');
const jsonfile = require('jsonfile');
const objectAssign = require('object-assign');
const path = require('path');
const readlineSync = require('readline-sync');

const fuzzyRegex = require('./lib/fuzzy-regex');
const reporter = require('./lib/reporter');

const schemaJSON = require('./config/schema.json');
const stationsJSON = require('./config/stations.json');
const authPath = path.join(__dirname, './config/auth-token.json');

module.exports = init;

const pm = require('./lib/pm');

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
	// can throw Err
	var schema = JSON.parse(JSON.stringify(schemaJSON));
	var presetStations = JSON.parse(JSON.stringify(stationsJSON));
	// set up generate options
	var options = {
		url: cliArgs.station ? presetStations[cliArgs.station] : cliArgs.url,
		schema: cliArgs.station ? schema.bbc_station : schema.bbc_playlister,
		guided: cliArgs.guided || false,
		replaceExisting: cliArgs.replaceExisting || false,
		auth: null
	};
	// check url
	if (!checkUrl(options.url)) {
		reporter.exit(new Error('Not a valid BBC Playlist url'));
	}
	// check auth file
	jsonfile.readFile(authPath, function(error, data) {
		if (!error) {
			checkAuth(data, function(err, result) {
				if (!err) {
					options.auth = result;
					return generate(options);
				}
				error = err;
			});
		}
		if (error) {
			reporter.exit(new Error('Need to authorise gpm-playlister first, run the login command.\nDetails: ' + error.message));
		}
	});
}
/**
 * CHECK AUTH-TOKEN FILE
 * will validate the auth-token file and its contents
 * @param {Data} - authFileData - the contents of config/auth-token.json
 * @callback {err, Object} - authFileData - the verified androidId and masterToken
 */
function checkAuth(authFileData, callback) {
	// issue with contents of file
	if (authFileData.constructor !== Object) {
		return callback(new Error('The contents of auth-token file are corrupt'));
	}
	// check if valid
	if (authFileData && authFileData.androidId && authFileData.masterToken) {
		return callback(null, authFileData);
	}
	// invalid credentials
	callback(new Error('Invalid auth-token'));
}
/**
 * CHECK URL IS VALID
 * @param {String} - url - the url to check
 * @return {Boolean} - isValid - if url is a valid bbc playlister url
 */
function checkUrl(url) {
	var isValid = false;
	if (url && url.search(/bbc\.co\.uk/ig) !== -1) {
		isValid = true;
	}
	return isValid;
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
	pm.init(options.auth)
		.then(() => {

			// Generate a playlist
			async.waterfall([
				function(cbAsync) {
					// Fetch the Playlister tracklist
					fetchPlrTracklist(options, function(err, plrTracklist) {
						if (!err) {
							reporter.info(
								'Playlist \"' + plrTracklist.playlist_name + '\" at ' + plrTracklist.playlist_source + ' is ' + plrTracklist.track_list.length + ' tracks long ' +
								'\n\nSearching Google Play Music for matching tracks...'
							);
						}
						cbAsync(err, plrTracklist);
					});
				},
				function(plrTracklist, cbAsync) {
					// Add GPM Store IDs to items in track_list where there is a GPM match
					fetchGPMStoreIds(plrTracklist.track_list, options, function(err, matchedTracklist) {
						if (!err) {
							reporter.info('Finished searching Google Play Music, matched ' + matchedTracklist.matches + ' of ' + matchedTracklist.track_list.length + ' tracks');
							plrTracklist = objectAssign(plrTracklist, matchedTracklist);
						}
						cbAsync(err, plrTracklist);
					});
				},
				function(plrTracklist, cbAsync) {
					// Push the playlist to GPM
					reporter.info('\nPushing playlist to Google Play Music...');
					pushGPMPlaylist(plrTracklist, options, function(err, report) {
						cbAsync(err, report);
					});
				}
			], function(err, report) {
				if (err) {
					reporter.exit(err);
				}
				// Exit and serve report
				reporter.finish(report);
			});

		})
		.catch(err => {
			reporter.exit(new Error('There was a problem connecting to Google Play Music' + '\nDetails: ' + err.message));
		});
}
/**
 * FETCH BBC PLAYLISTER PLAYLIST
 * Grabs html body from given url and performs a transformation on the result
 * @param {Object} options - app options
 * @callback {err, Object} - autoParsedBody - the result of parsePlrTracklist
 */
function fetchPlrTracklist(options, callback) {
	fetch(options.url)
		.then(res => res.text())
		.then(body => parsePlrTracklist(body, options.url, options.schema))
		.then(autoParsedBody => callback(null, autoParsedBody))
		.catch(err => {
			err.message = 'There was an error with the content of: ' + options.url + '\nDetails: ' + err.message;
			callback(err);
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
	var $ = cheerio.load(htmlString);
	var selector = schema;
	var plrTracklist = {
		playlist_name: null,
		playlist_description: 'source: ' + sourceUrl + ' (generated by http://www.github.com/tavvy/GPM-Playlister)',
		playlist_source: sourceUrl,
		track_list: []
	};

	plrTracklist.playlist_name = $(selector.playlist_name_selector).text().trim() || null;

	if (selector.playlist_desc_selector === 'meta') {
		plrTracklist.playlist_description = ($('meta[name=description]').attr('content').trim() || null) + ' | ' + plrTracklist.playlist_description;
	} else {
		plrTracklist.playlist_description = ($(selector.playlist_desc_selector).text().trim() || null) + ' | ' + plrTracklist.playlist_description;
	}

	$(selector.track_selector, selector.tracklist_selector).each(function(i, el) {
		var track_artist = $(selector.artist_selector, el).text().trim() || $(selector.alt_artist_selector, el).text().trim() || null;
		var track_title = $(selector.title_selector, el).text().trim() || null;
		plrTracklist.track_list.push({
			title: track_title,
			artist: track_artist
		});
	});

	return plrTracklist;
}
/**
 * CREATE GPM STORE ID ARRAY
 * Search GPM for tracks in Playlister Tracklist and save the match's GPM-Store-ID to array
 * @param {Array} trackList - an array of objects containing track title and artists
 * @param {Object} options - app options
 * @callback {err, Array} - storeIds - an array of GPM-Store-IDs
 */
function fetchGPMStoreIds(trackList, options, callback) {
	var response = {
		track_list: trackList,
		matches: 0
	};

	// for each song in the trackList
	async.forEachOf(response.track_list, function(track, i, cbAsync) {

		// search GPM for "<artist> <title>", max 5 results
		pm.search(track.artist + ' ' + track.title, 5)
			.then(data => {
				if (data.entries) {
					matchResult(data.entries, track, options, function(match) {
						if (match.storeId) {
							response.matches++;
							track.gpmStoreId = match.storeId;
						}
					});
				} else {
					reporter.match(null, track);
				}
				cbAsync(null);
			})
			.catch(err => {
				reporter.match(null, track);
				cbAsync(err);
			});

	}, function(err) {
		if (err) {
			err.message = 'There was a problem searching Google Play Music' + '\nDetails: ' + err.message;
		}
		callback(err, response);
	});
}
/**
 * FIND A MATCHING TRACK IN A LIST OF RESULTS
 * Find a matching track in a list of GPM search results
 * @param {Array} results - an array of GPM search results containing track title and artists
 * @param {Object} query - contains the title and artist of the track to find
 * @param {Object} options - app options
 * @callback {Object} - match - contains match data, type and its GPM-Store-ID
 */
function matchResult(results, query, options, callback) {
	var match = {
		data: null,
		matchType: 0,
		storeId: null
	};

	// try and find a matching result
	results.forEach(function(item) {
		// if its a valid song and we havnt found a match yet
		if (!match.data && validateGPMSongResult(item, query)) {

			if (item.track.title.toUpperCase() === query.title.toUpperCase()) {
				// exact title match
				match.data = item;
				match.matchType = 1;
				match.storeId = item.track.storeId;
			} else if (fuzzyMatchTitle(item, query)) {
				// fuzzy title match
				match.data = item;
				match.matchType = 2;
				match.storeId = item.track.storeId;
			}

		}
	});

	// ask user for help
	if (!match.data && options.guided) {
		userMatch(results, query, function(item) {
			if (item) {
				// user match
				match.data = item;
				match.matchType = 3;
				match.storeId = item.track.storeId;
			}
		});
	}

	// report the match
	reporter.match(match.matchType, query, match.data);

	callback(match);
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
	var isMatch = false;
	if (fuzzTitle(result.track.title) === fuzzTitle(query.title)) {
		isMatch = true;
	}
	return isMatch;
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
function pushGPMPlaylist(plrTracklist, options, callback) {
	var response = {
		playlist_id: null,
		playlist_url: null,
		pushed: 0,
		cut: 0,
		type: null,
		new_entries: mapStoreIds(plrTracklist.track_list),
		removed_entries: null
	};

	response = objectAssign(plrTracklist, response);

	async.waterfall([
		function(cbAsync) {
			getGPMPlaylistId(response.playlist_name, options, function(err, result) {
				if (!err && result) {
					response = objectAssign(response, result);
				}
				cbAsync(err);
			});
		},
		function(cbAsync) {

			return clearGPMPlaylistEntries(response.playlist_id)
				.then(result => {
					response = objectAssign(response, result);
					cbAsync(null);
				})
				.catch(err => cbAsync(err));

		},
		function(cbAsync) {
			appendGPMPlaylist(response.playlist_id, response.new_entries, options, function(err, result) {
				if (!err && result) {
					response = objectAssign(response, result);
				}
				cbAsync(err);
			});
		},
		function(cbAsync) {
			updateGPMPlaylistDescription(response.playlist_id, response.playlist_description, function(result) {
				response = objectAssign(response, result);
				cbAsync();
			});
		}
	], function(err) {
		callback(err, response);
	});

}
/**
 * MAP GPM-STORE-IDS
 * Will first filter and then store tracklist entries with a GPM-Store-ID
 * @param {Array} trackList - an array of objects containing tracks title, artist and optional GPM-Store-ID
 * @returns {Array} storeIdList - an array of GPM-Store-IDS
 */
function mapStoreIds(trackList) {
	var storeIdList = [];
	storeIdList = trackList.filter(function(el) {
		return el.gpmStoreId ? true : false;
	}).map(function(el) {
		return el.gpmStoreId;
	});
	return storeIdList;
}
/**
 * GET GPM PLAYLIST ID
 * will either replace an existing playlist or create a new one and return its id
 * @param {String} name - the name of the GPM playlist to create or replace
 * @param {Object} options - app options
 * @callback {err, Object} - response - contains playlist id, url and type
 */
function getGPMPlaylistId(name, options, callback) {
	var response = {
		playlist_id: null,
		playlist_url: null,
		type: null
	};

	if (!options.replaceExisting) {
		// create new playlist
		response.type = 0;
		createGPMPlaylist(name, function(err, result) {
			response = objectAssign(response, result);
			return callback(err, response);
		});

	} else {

		pm.getPlayLists().then(playlists => {
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
				return callback(null, response);
			}

			// Nothing to replace, create a new playlist
			response.type = 2;
			createGPMPlaylist(name, function(err, result) {
				response = objectAssign(response, result);
				callback(err, response);
			});

		})
		.catch(err => {
			err.message = 'There was a problem finding Google Play Music Playlists' + '\nDetails: ' + err.message;
			return callback(err);
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

	return pm.getPlayListEntries()
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
					response = objectAssign(response, result);
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
function createGPMPlaylist(name, callback) {
	var result = {
		playlist_id: null,
		playlist_url: null
	};


	pm.addPlayList(name)
		.then(response => {
			// map the response from: {mutate_response: [{id:val}]}
			result.playlist_id = response.mutate_response[0].id || null;

			getPlaylistUrl(result.playlist_id, function(url) {
				result.playlist_url = url;
				callback(null, result);
			});
		})
		.catch(err => {
			err.message = 'There was a problem creating a Google Play Music Playlist' + '\nDetails: ' + err.message;
			return callback(err);
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

	return pm.removePlayListEntry(playlistEntries)
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
function appendGPMPlaylist(playlistId, storeIdList, options, callback) {
	var result = {
		pushed: storeIdList.length
	};

	pm.addTrackToPlayList(storeIdList, playlistId)
		.then(() => callback(null, result))
		.catch(err => {
			err.message = 'There was a problem adding tracks to Google Play Music playlist' + '\nDetails: ' + err.message;
			callback(err, null);
		});
}
/**
 * GET A GPM PLAYLIST URL
 * get a GPM playlists' url given its ID
 * @param {String} playlistId - the ID of the GPM playlist
 * @callback {String} - result - the url or null
 */
function getPlaylistUrl(playlistId, callback) {
	var url = null;

	pm.getPlayLists().then(playlists => {
		// find match
		if (playlists && playlists.data && playlists.data.items) {
			playlists.data.items.forEach(function(item) {
				if (item.id === playlistId) {
					url = item.shareToken || null;
				}
			});
		}
		callback(url);
	})
	.catch(err => {
		reporter.warn('There was a problem finding Google Play Music Playlists' + '\nDetails: ' + err.message);
		return callback(url);
	});
}
/**
 * UPDATE A GPM PLAYLIST DESCRIPTION
 * update a GPM playlists' description given its ID
 * @param {String} playlistId - the ID of the GPM playlist
 * @param {String} - description - the description
 * @callback {Object} - response - contains the playlist description
 */
function updateGPMPlaylistDescription(playlistId, description, callback) {
	var response = {
		playlist_description: description
	};
	var updates = {
		description: description
	};

	pm.updatePlayListMeta(playlistId, updates)
		.then(() => callback(response))
		.catch(err => {
			reporter.warn('Could not update the Google Play Music playlist description' + '\nDetails: ' + err.message);
			response.playlist_description = null;
			callback(response);
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
