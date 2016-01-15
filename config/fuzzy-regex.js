
'use strict';

module.exports = [
	{
		regexp: /\(RADIO EDIT\) | \(RADIO EDIT\)|\(RADIO EDIT\)/ig, // (radio edit) with space before or after
		delete: true
	},
	{
		regexp: /\&/ig, // & ampersands
		replace: 'AND'
	},
	{
		regexp: /FEAT\.|FEATURING/ig, // feat. or feat or featuring
		replace: 'FEAT'
	},
	{
		regexp: /\(|\)/ig, // parenthesis
		delete: true
	},
	{
		regexp: /\'|\’/ig, // odd apostrophes
		replace: '\''
	},
	{
		regexp: /\?/ig, // ? question marks
		delete: true
	}
];