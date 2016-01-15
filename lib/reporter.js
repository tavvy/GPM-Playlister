
'use strict';

var chalk = require('chalk');

var theme = {
	success: chalk.green,
	warn: chalk.yellow,
	err: chalk.red,
	info: chalk.blue,
	bg: chalk.gray,
	matchType1: chalk.green,
	matchType2: chalk.yellow,
	matchType3: chalk.yellow
};

/*
 * EXPORTS A FUNCTION FOR A SIMPLE MESSAGE LOG FOR EACH THEME TYPE
 * can then be called with reporter.<theme>(<message)
 */
Object.keys(theme).forEach(function(level) {
	exports[level] = function(message) {
		console.log(theme[level](message));
	};
});

/*
 * REPORT MATCHES
 * matchType: null = no results, 0 = no match, 1 = exact match, 2 = fuzzy match, 3 = user match
 */
exports.match = function(matchType, query, match) {

	if (matchType && match) {
		var matchMessage = matchType === 3 ? 'User match' : 'Found match';

		return console.log(
			theme['matchType' + matchType](matchMessage + ' ') +
			theme.info(query.artist + ' - ' + query.title) +
			theme.bg(' -> ') +
			theme.warn(match.track.artist + ' - ' + match.track.title)
		);
	}

	var matchMessage = matchType === 0 ? 'No match' : 'No results';

	console.log(
		theme.err(matchMessage + ' ') +
		theme.info(query.artist + ' - ' + query.title)
	);
};
