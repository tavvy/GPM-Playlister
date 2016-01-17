
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

var schema = JSON.parse(JSON.stringify(require(path.join(__dirname, '..', 'config/schema'))));
var presetStations = JSON.parse(JSON.stringify(require(path.join(__dirname, '..', 'config/stations'))));
var userConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config/user-data.json')));
var fuzzyRegex = require(path.join(__dirname, '..', 'config/fuzzy-regex.js'));

var pm = new PlayMusic();

module.exports = app;

function app(options) {
	// set up options
	options.schema = options.station ? schema.bbc_station : schema.bbc_playlister;
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

	// init Play Music
	pm.init(userConfig, function(err) {

		if (err) {
			reporter.exit(new Error('There was a problem logging into Google Play Music' + '\nDetails: ' + err.message));
		}

		async.waterfall([
			function(cbAsync) {
				fetchPlrTracklist(options, function(err, plrTracklist) {
					if (!err) {
						reporter.info('Playlist \"' + plrTracklist.name + '\" at ' + options.url + ' is ' + plrTracklist.tracks.length + ' tracks long');
					}
					cbAsync(err, plrTracklist);
				});
			},
			function(plrTracklist, cbAsync) {
				createGPMStoreIdList(plrTracklist.tracks, options, function(err, storeIdList) {
					if (!err) {
						reporter.info('Finished search we have ' + storeIdList.length + ' of ' + plrTracklist.tracks.length + ' matches');
					}
					cbAsync(err, storeIdList, plrTracklist.name);
				});
			},
			function(storeIdList, playlistName, cbAsync) {
				pushGPMPlaylist(storeIdList, playlistName, options, function(err, report) {
					cbAsync(err, report);
				});
			}
		], function(err, result) {
			if (err) {
				reporter.exit(err);
			}
			reporter.finish(result);
		});

	});

}

function checkLogin() {
	var isValid = false;
	if (userConfig.androidId && userConfig.masterToken) {
		isValid = true;
	}
	return isValid;
}

function checkUrl(url) {
	var isValid = false;
	if (url && url.search(/bbc\.co\.uk/ig) !== -1) {
		isValid = true;
	}
	return isValid;
}

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

function createGPMStoreIdList(trackList, options, callback) {
	var storeIds = [];

	// for each song in the trackList
	async.forEachOf(trackList, function(track, i, cbAsync) {

		// search Google Music for <artist> <title>, max 5 results
		pm.search(track.artist + ' ' + track.title, 5, function(err, data) {
			if (!err && data.entries) {
				matchResult(data.entries, track, options, function(matchStoreId) {
					if (matchStoreId) {
						storeIds.push(matchStoreId);
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

			if (item.track.title.toUpperCase() === query.title.toUpperCase()) { // exact match title
				match.data = item;
				match.matchType = 1;
				match.storeId = item.track.storeId;
			} else if (fuzzyMatchTitle(item, query)) {
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
				match.data = item;
				match.matchType = 3;
				match.storeId = item.track.storeId;
			}
		});
	}

	reporter.match(match.matchType, query, match.data);

	return callback(match.storeId);
}

/*
 * VALIDATE GPM SONG
 * check that the result is a valid song, query optional
 * if query is passed, will also validate that the artists match
 */
function validateGPMSongResult(result, query) {
	var isValid = false;
	if (result.type === 1 || '1' && result.track && result.track.artist && result.track.title && result.track.storeId) {
		isValid = true;
	}
	if (isValid && query && result.track.artist.toUpperCase() !== query.artist.toUpperCase()) {
		isValid = false;
	}
	return isValid;
}

/*
 * FUZZY MATCH TITLE
 * will attempt to find a fuzzy match on the result and query
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
 * returns answer, can be null
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

function pushGPMPlaylist(storeIdList, playlistName, options, callback) {
	var response = {
		playlist_name: playlistName,
		playlist_id: null,
		pushed: 0,
		cut: 0,
		type: null,
		newEntries: storeIdList
	};
	async.waterfall([
		function(cbAsync) {
			getGPMPlaylistId(response.playlist_name, options, function(err, result) {
				if (!err && result) {
					response.playlist_id = result.playlist_id;
				}
				cbAsync(err);
			});
		},
		function(cbAsync) {
			clearGPMPlaylist(response.playlist_id, function(err, result) {
				if (!err && result) {
					response.cut = result.cut;
				}
				cbAsync(err);
			});
		},
		function(cbAsync) {
			appendGPMPlaylist(response.playlist_id, response.newEntries, options, function(err, result) {
				if (!err && result) {
					response.pushed = result.pushed
				}
				cbAsync(err, result);
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
		type: null
	}

	if (!options.replaceExisting) {

		createGPMPlaylist(name, function(err, playlistId) {
			reporter.info('Making a new GPM playlist');
			response.playlist_id = playlistId;
			return callback(err, response);
		});

	} else {

		pm.getPlayLists(function(err, playlists) {
			if (err) {
				err.message = 'There was a problem finding Google Play Music Playlists' + '\nDetails: ' + err.message;
				return callback(err);
			}

			// if there are several matches this is just going to use the 'last' matching instance
			playlists.data.items.forEach(function(item) {
				// console.log(item); // debugging
				if (matchGPMPlaylistName(item, name)) {
					response.playlist_id = item.id;
				}
			});

			if (response.playlist_id) {
				reporter.info('Replacing existing GPM playlist');
				return callback(null, response);
			}

			reporter.info('Making a new GPM playlist as there are no matching to replace');
			createGPMPlaylist(name, function(err, playlistId) {
				response.playlist_id = playlistId;
				callback(err, response);
			});

		});
	}

}
// clear out the contents of a GPM Playlist
function clearGPMPlaylist(playlistId, callback) {
	var response = {
		id: playlistId,
		cut: null,
		existingSongs: []
	};
	pm.getPlayListEntries(function(err, result) {
		if (err) {
			err.message = 'There was a problem emptying the existing Google Play Music Playlist' + '\nDetails: ' + err.message;
			return callback(err);
		}

		result.data.items.forEach(function(item) {
			if (item.playlistId === playlistId) {
				response.existingSongs.push(item.id);
			}
		});

		if (!response.existingSongs.length > 0) {
			return callback(null, response);
		}

		reporter.info('Clearing out ' + response.existingSongs.length + ' tracks from existing playlist');

		cutGPMPlaylistEntry(response.existingSongs, function(err, result) {
			if (err) {
				err.message = 'There was a problem emptying the existing Google Play Music Playlist' + '\nDetails: ' + err.message;
				return callback(err);
			}
			response.cut = result.pushed;
			callback(err, response);
		});

	});

}
// create playlist
function createGPMPlaylist(name, callback) {
	var playlistId = null;
	pm.addPlayList(name, function(err, response) {
		if (err) {
			err.message = 'There was a problem creating a Google Play Music Playlist' + '\nDetails: ' + err.message;
			callback(err);
		}
		// map the response from: {mutate_response: [{id:val}]}
		playlistId = response.mutate_response[0].id || null;
		callback(null, playlistId);
	});
}
// remove tracks from a playlist
function cutGPMPlaylistEntry(playlistEntries, callback) {
	var pushes = 0;
	playlistEntries.forEach(function (entryId, i, array) {
		pm.removePlayListEntry(entryId, function(err, result) {
			if (err) {
				reporter.err('There was a problem removing a track from a Google Play Music playlist' + '\nDetails: ' + err.message);
			}
			pushes++;
			if (i + 1 === array.length) {
				callback(null, {pushed: pushes})
			}
		});
	});

}
// add tracks to a playlist
function appendGPMPlaylist(playlistId, storeIdList, options, callback) {
	var pushes = 0;
	storeIdList.forEach(function (trackId, i, array) {
		pm.addTrackToPlayList(trackId, playlistId, function(err, result) {
			if (err) {
				reporter.err('There was a problem adding a track to Google Play Music playlist' + '\nDetails: ' + err.message);
			}
			pushes++;
			if (i + 1 === array.length) {
				callback(null, {pushed: pushes});
			}
		});
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
