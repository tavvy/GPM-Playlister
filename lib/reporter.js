
'use strict';

var chalk = require('chalk');

var theme = {
	success: chalk.green,
	warn: chalk.yellow,
	err: chalk.red,
	info: chalk.cyan,
	bbc: chalk.blue,
	gpm: chalk.yellow,
	dim: chalk.dim,
	matchType1: chalk.green,
	matchType2: chalk.yellow,
	matchType3: chalk.yellow
};

/*
 * THEMED REPORTS
 * exports a function for each theme type
 * @param {String} message - message to log out
 * can then be called with reporter.<theme>(<message)
 */
Object.keys(theme).forEach(function(level) {
	exports[level] = function(message) {
		console.log(theme[level](message));
	};
});
/*
 * REPORT MATCHES
 * log out a pretty match for the search results
 * @param {Int} matchType - null = no results, 0 = no match, 1 = exact match, 2 = fuzzy match, 3 = user match
 * @param {Object} query - contains query artist and title
 * @param {Object} match - contains match artist and title
 */
exports.match = function(matchType, query, match) {

	if (matchType && match) {
		var matchMessage = matchType === 3 ? 'User match ' : 'Found match';

		return console.log(
			theme['matchType' + matchType](matchMessage + ' ') +
			theme.bbc(query.artist + ' - ' + query.title) +
			theme.dim(' -> ') +
			theme.gpm(match.track.artist + ' - ' + match.track.title)
		);
	}

	var matchMessage = matchType === 0 ? 'No match   ' : 'No results ';

	console.log(
		theme.err.dim(matchMessage + ' ') +
		theme.bbc.dim(query.artist + ' - ' + query.title)
	);
};
/*
 * EXIT
 * report the fatal error and exit
 * @param {Object} err - Err object
 */
exports.exit = function(err) {
	console.log(theme.err.bold('Fatal error'));
	console.log(theme.err(err));
	process.exit(1);
};
/*
 * FINAL REPORT
 * log out the final report and exit
 * report.type: null = likely error, 0 = new playlist, 1 = replace playlist, 2 = new playlist as none to replace
 * @param {Object} report - the final report
 */
exports.finish = function(report) {
	var detailedReport = null;
	if (report.type === 0) {
		detailedReport = '\nCreated a new Google Play Music playlist with ' + report.pushed + ' tracks';
	} else if (report.type === 1) {
		detailedReport = '\nReplaced an existing Google Play Music playlist with ' + report.pushed + ' tracks, removing ' + report.cut + ' tracks';
	} else if (report.type === 2) {
		detailedReport = '\nCreated a new Google Play Music playlist with ' + report.pushed + ' tracks, despite using the --replace option there were no existing matching playlists';
	}

	console.log(
		theme.success.inverse('Finished') + ' ' +
		theme.success.bold.underline('https://play.google.com/music/listen?u=0#/pl/' + report.playlist_url) +
		theme.info('\nGenerated \"' + report.playlist_name + '\" from ' + report.playlist_source + ' with ' + report.matches + '/' + report.track_list.length + ' matching tracks') +
		theme.info.dim(detailedReport)
	);

	process.exit(0);
};
