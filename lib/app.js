
'use strict';

var fs = require('fs');
var path = require('path');
var chalk = require('chalk');
var rp = require('request-promise');
var cheerio = require('cheerio');
var PlayMusic = require('playmusic');
var async = require('async');
var readlineSync = require('readline-sync');
var reporter = require('./reporter');

// can throw Err
var schema = JSON.parse(JSON.stringify(require(path.join(__dirname, '..', 'config/schema'))));
var presetStations = JSON.parse(JSON.stringify(require(path.join(__dirname, '..', 'config/stations'))));
var userConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config/user-data.json')));
var fuzzyRegex = require(path.join(__dirname, '..', 'config/fuzzy-regex.js'));

module.exports = app;

var pm = new PlayMusic();
/*
 * APP ENTRY POINT
 * @param {Object} - options
 *	{
 *		url: {String} either url or null
 *		station: {String} either key name to find in presetStations or null
 *		guided: {Boolean} allow user to help match
 *		replaceExisting: {Boolean} replace existing GPM playlist if there is a match
 *	}
 */
function app(options) {
	// set the schema to Playister or Station
	options.schema = options.station ? schema.bbc_station : schema.bbc_playlister;
	// set the url to a matching presetStation or the provided url
	options.url = options.station ? presetStations[options.station] : options.url;

	// check logged in
	if (!checkLogin()) {
		reporter.exit(new Error('need to set up login first'));
	}
	// check url
	if (!checkUrl(options.url)) {
		reporter.exit(new Error('not a valid bbc playlister url'));
	}

	reporter.info('Building a playlist from: ' + options.url);

	// init PlayMusic
	pm.init(userConfig, function(err) {
		if (err) {
			reporter.exit(new Error('There was a problem logging into Google Play Music' + '\nDetails: ' + err.message));
		}
		// Generate a playlist
		async.waterfall([
			function(cbAsync) {
				// Fetch the Playlister tracklist
				fetchPlrTracklist(options, function(err, plrTracklist) {
					if (!err) {
						reporter.info('Playlist \"' + plrTracklist.name + '\" at ' + options.url + ' is ' + plrTracklist.tracks.length + ' tracks long');
					}
					cbAsync(err, plrTracklist);
				});
			},
			function(plrTracklist, cbAsync) {
				// Create a list for GPM tracks that match the Playlister tracklist
				createGPMStoreIdList(plrTracklist.tracks, options, function(err, storeIdList) {
					if (!err) {
						reporter.info('Finished search we have ' + storeIdList.length + ' of ' + plrTracklist.tracks.length + ' matches');
					}
					cbAsync(err, storeIdList, plrTracklist.name);
				});
			},
			function(storeIdList, playlistName, cbAsync) {
				// Push the GPM tracks to a GPM playlist
				reporter.info('Pushing playlist to Goolge Play Music');
				pushGPMPlaylist(storeIdList, playlistName, options, function(err, report) {
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
	});
}
/*
 * CHECK USER LOGIN DETAILS
 * @return {Boolean} - isValid - if user login details are saved
 */
function checkLogin() {
	var isValid = false;
	if (userConfig.androidId && userConfig.masterToken) {
		isValid = true;
	}
	return isValid;
}
/*
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
/*
 * FETCH BBC PLAYLISTER PLAYLIST
 * Grabs html body from given url and performs a transformation on the result
 * @param {Object} options - app options
 * @callback {err, Object} - autoParsedBody - the result of parsePlrTracklist
 */
function fetchPlrTracklist(options, callback) {
	var opts = {
		uri: options.url,
		transform: function(htmlString) {
			return parsePlrTracklist(htmlString, options.schema);
		}
	};
	rp(opts)
	.then(function(autoParsedBody) {
		callback(null, autoParsedBody);
	})
	.catch(function(err) {
		err.message = 'there was an error with the content of: ' + opts.uri + '\nDetails: ' + err.message;
		callback(err);
	});
}
/*
 * PARSE BBC PLAYLISTER BODY HTML
 * Builds a Playlister Tracklist given html body as string and a schema to search by
 * @param {string} htmlString - an html body as string
 * @param {Object} schema - contains jQuery style selectors to search htmlString
 * @return {Object} - plrTracklist - contains the playlist name and array of tracks containing title and artists
 */
function parsePlrTracklist(htmlString, schema) {
	var $ = cheerio.load(htmlString);
	var selector = schema;
	var plrTracklist = {
		name: null,
		tracks: []
	};

	plrTracklist.name = $(selector.playlist_name).text().trim() || null;

	$(selector.track_selector, selector.tracklist_selector).each(function(i, el) {
		var track_artist = $(selector.artist_selector, el).text().trim() || $(selector.alt_artist_selector, el).text().trim() || null;
		var track_title = $(selector.title_selector, el).text().trim() || null;
		plrTracklist.tracks.push({
			title: track_title,
			artist: track_artist
		});
	});

	return plrTracklist;
}
/*
 * CREATE GPM STORE ID ARRAY
 * Search GPM for tracks in Playlister Tracklist and save the match's GPM-Store-ID to array
 * @param {Array} trackList - an array of objects containing track title and artists
 * @param {Object} options - app options
 * @callback {err, Array} - storeIds - an array of GPM-Store-IDs
 */
function createGPMStoreIdList(trackList, options, callback) {
	var storeIds = [];

	// for each song in the trackList
	async.forEachOf(trackList, function(track, i, cbAsync) {

		// search GPM for "<artist> <title>", max 5 results
		pm.search(track.artist + ' ' + track.title, 5, function(err, data) {
			if (!err && data.entries) {
				matchResult(data.entries, track, options, function(match) {
					if (match.storeId) {
						storeIds.push(match.storeId);
					}
				});
			} else {
				reporter.match(null, track);
			}
			cbAsync(err);
		});

	}, function(err) {
		if (err) {
			err.message = 'There was a problem searching Google Play Music' + '\nDetails: ' + err.message;
		}
		callback(err, storeIds);
	});
}
/*
 * FIND A MATCHING TRACK IN A LIST OF RESULTS
 * Find a matching track in a list of GPM search results
 * @param {Array} results - an array of GPM search results containing track title and artists
 * @param {Object} query - contains the title and artist of the track to find
 * @param {Object} options - app options
 * @callback {err, Object} - match - contains match data, type and its GPM-Store-ID
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
/*
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
/*
 * FUZZY MATCH TITLE
 * will attempt to find a fuzzy title match on the result from query
 * @param {Object} result - GPM search result
 * @param {Object} query - contains the title and artist of the track to find
 * @return {Boolean} - isMatch - if title is a fuzzy match
 */
function fuzzyMatchTitle(result, query) {
	var queryTitle = query.title.toUpperCase();
	var targetTitle = result.track.title.toUpperCase();
	var isMatch = false;

	if (fuzzTitle(targetTitle) === fuzzTitle(queryTitle)) {
		isMatch = true;
	}
	return isMatch;
}
/*
 * FUZZ-IFY A TITLE
 * will perfom some basic transformations on a string to help fuzzy match
 * @param {String} title - the title
 * @return {String} fuzzyTitle - a fuzz-ified version of the title
 */
function fuzzTitle(title) {
	var fuzzyTitle = title;
	var phrases = fuzzyRegex;

	phrases.forEach(function(phrase) {
		if (fuzzyTitle.search(phrase.regexp) !== -1) {
			if (phrase.replace) {
				fuzzyTitle = fuzzyTitle.replace(phrase.regexp, phrase.replace);
			}
			if (phrase.delete) {
				fuzzyTitle = fuzzyTitle.replace(phrase.regexp, '');
			}
		}
	});

	return fuzzyTitle;
}
/*
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
			chalk.green(
				'Possible match. Which of the above is match for: ' +
				chalk.blue(query.artist + ' - ' + query.title)
			)
		);

		var answerKey = Object.keys(mappedResults)[userAnswerIndex];
		match = mappedResults[answerKey];

	}

	callback(match);
}

/* PLAYLIST FUNCTIONS */

function pushGPMPlaylist(storeIdList, playlistName, options, callback) {
	var response = {
		playlist_name: playlistName,
		playlist_id: null,
		playlist_url: null,
		pushed_goal: 0,
		pushed: 0,
		cut_goal: 0,
		cut: 0,
		type: null,
		newEntries: storeIdList,
		existingEntries: null
	};

	async.waterfall([
		function(cbAsync) {
			getGPMPlaylistId(response.playlist_name, options, function(err, result) {
				if (!err && result) {
					response = Object.assign(response, result);
				}
				cbAsync(err);
			});
		},
		function(cbAsync) {
			clearGPMPlaylistEntries(response.playlist_id, function(err, result) {
				if (!err && result) {
					response = Object.assign(response, result);
				}
				cbAsync(err);
			});
		},
		function(cbAsync) {
			appendGPMPlaylist(response.playlist_id, response.newEntries, options, function(err, result) {
				if (!err && result) {
					response = Object.assign(response, result);
				}
				cbAsync(err);
			});
		}
	], function(err) {
		callback(err, response);
	});

}

// get a playlist id
// will either replace an existing if flag on and one is there to replace
// or create new one
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
			response = Object.assign(response, result);
			return callback(err, response);
		});

	} else {

		pm.getPlayLists(function(err, playlists) {
			if (err) {
				err.message = 'There was a problem finding Google Play Music Playlists' + '\nDetails: ' + err.message;
				return callback(err);
			}

			// Replace an existing playlist
			playlists.data.items.forEach(function(item) {
				// find 'latest' match
				if (matchGPMPlaylistName(item, name)) {
					response.playlist_id = item.id;
					response.playlist_url = item.shareToken;
				}
			});
			if (response.playlist_id) {
				response.type = 1;
				return callback(null, response);
			}

			// Nothing to replace, create a new playlist
			response.type = 2;
			createGPMPlaylist(name, function(err, result) {
				response = Object.assign(response, result);
				callback(err, response);
			});

		});
	}

}
// clear out the contents of a GPM Playlist
function clearGPMPlaylistEntries(playlistId, callback) {
	var response = {
		cut_goal: null,
		cut: null,
		existingEntries: []
	};

	pm.getPlayListEntries(function(err, result) {
		if (err) {
			err.message = 'There was a problem emptying the existing Google Play Music Playlist' + '\nDetails: ' + err.message;
			return callback(err);
		}

		result.data.items.forEach(function(item) {
			if (item.playlistId === playlistId) {
				response.existingEntries.push(item.id);
			}
		});

		if (response.existingEntries.length === 0) {
			return callback(null, response);
		}

		cutGPMPlaylistEntry(response.existingEntries, function(err, result) {
			if (err) {
				err.message = 'There was a problem emptying the existing Google Play Music Playlist' + '\nDetails: ' + err.message;
				return callback(err);
			}
			response.cut_goal = result.actions;
			response.cut = result.actions - result.failed;
			callback(err, response);
		});

	});

}
// create playlist
function createGPMPlaylist(name, callback) {
	var result = {
		playlist_id: null,
		playlist_url: null
	};

	pm.addPlayList(name, function(err, response) {
		if (err) {
			err.message = 'There was a problem creating a Google Play Music Playlist' + '\nDetails: ' + err.message;
			callback(err);
		}
		// map the response from: {mutate_response: [{id:val}]}
		result.playlist_id = response.mutate_response[0].id || null;

		getPlaylistUrl(result.playlist_id, function(err, url) {
			// ignore errors we dont NEED the url
			result.playlist_url = url;
			callback(null, result);
		});

	});
}
// remove tracks from a playlist
function cutGPMPlaylistEntry(playlistEntries, callback) {
	var result = {
		actions: 0,
		failed: 0
	};

	playlistEntries.forEach(function(entryId, i, array) {
		pm.removePlayListEntry(entryId, function(err) {
			if (err) {
				reporter.err('There was a problem removing a track from a Google Play Music playlist' + '\nDetails: ' + err.message);
				result.failed++;
			}
			result.actions++;
			if (result.actions === array.length) {
				callback(null, result);
			}

		});
	});
}
// add tracks to a playlist
function appendGPMPlaylist(playlistId, storeIdList, options, callback) {
	var result = {
		pushed_goal: storeIdList.length,
		pushed: 0
	};
	var progress = {
		actions: 0,
		failed: 0
	};
	storeIdList.forEach(function(trackId, i, array) {
		pm.addTrackToPlayList(trackId, playlistId, function(err) {
			if (err) {
				reporter.err('There was a problem adding a track to Google Play Music playlist' + '\nDetails: ' + err.message);
				progress.failed++;
			}
			progress.actions++;
			if (progress.actions === array.length) {
				result.pushed = progress.actions - progress.failed;
				callback(null, result);
			}
		});
	});
}
function getPlaylistUrl(playlistId, callback) {
	var url = null;
	pm.getPlayLists(function(err, playlists) {
		if (err) {
			err.message = 'There was a problem finding Google Play Music Playlists' + '\nDetails: ' + err.message;
			return callback(err, url);
		}
		playlists.data.items.forEach(function(item) {
			if (item.id === playlistId) {
				url = item.shareToken || null;
			}
		});
		callback(null, url);
	});
}
// match a playlist name
// I believe accessControlled=true means its shared
function matchGPMPlaylistName(playlist, name) {
	var isMatch = false;
	if (playlist.deleted === false && playlist.name === name && playlist.type === 'USER_GENERATED') {
		isMatch = true;
	}
	return isMatch;
}
