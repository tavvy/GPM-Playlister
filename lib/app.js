
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

	async.waterfall([
		function(cbAsync) {
			fetchPlrTracklist(options, function(err, trackList) {
				if (!err) {
					reporter.info('Playlist at ' + options.url + ' is ' + trackList.length + ' tracks long');
				}
				cbAsync(err, trackList);
			});
		},
		function(trackList, cbAsync) {
			createGPMStoreIdList(trackList, options, function(err, storeIdlist) {
				if (!err) {
					reporter.info('Finished search we have ' + storeIdlist.length + ' of ' + trackList.length + ' matches');
				}
				cbAsync(err, storeIdlist);
			});
		}
	], function(err, result) {
		if (err) {
			reporter.exit(err);
		}
		console.log(result);
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
	var trackList = [];
	var selector = schema;

	$(selector.track_selector, selector.tracklist_selector).each(function(i, el) {
		var track_artist = $(selector.artist_selector, el).text().trim() || $(selector.alt_artist_selector, el).text().trim() || null;
		var track_title = $(selector.title_selector, el).text().trim() || null;
		trackList.push({
			title: track_title,
			artist: track_artist
		});
	});

	return trackList;
}

function createGPMStoreIdList(trackList, options, callback) {
	var storeIds = [];

	pm.init(userConfig, function(err) {
		if (err) {
			err.message = 'There was a problem logging into Google Play Music' + '\nDetails: ' + err.message;
			callback(err);
		}

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
