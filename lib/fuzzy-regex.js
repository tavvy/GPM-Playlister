
'use strict';

const replace = (title, regexp, string) => title.replace(regexp, string);

const remove = (title, regexp) => title.replace(regexp, '');

/**
 * FUZZY REGEX PHRASES
 * Array of regexp to search and transformations to perform on successful find
 */
const transforms = [
	{
		regexp: /\(RADIO EDIT\) | \(RADIO EDIT\)|\(RADIO EDIT\)/ig, // (radio edit) with space before or after
		transform: (title, regexp) => remove(title, regexp)
	},
	{
		regexp: /\&/ig, // & ampersands
		transform: (title, regexp) => replace(title, regexp, 'AND')
	},
	{
		regexp: /FEAT\.|FEATURING|WITH/ig, // feat. or feat or featuring or with
		transform: (title, regexp) => replace(title, regexp, 'FEAT')
	},
	{
		regexp: /\(|\)/ig, // parenthesis
		transform: (title, regexp) => remove(title, regexp)
	},
	{
		regexp: /\'|\’/ig, // odd apostrophes
		transform: (title, regexp) => replace(title, regexp, '\'')
	},
	{
		regexp: /\?/ig, // ? question marks
		transform: (title, regexp) => remove(title, regexp)
	}
];

const fuzzify = (str) => {
	let fuzzed = str.toUpperCase();
	transforms.forEach(t => {
		if (fuzzed.search(t.regexp) !== -1) {
			fuzzed = t.transform(fuzzed, t.regexp);
		}
	});
	return fuzzed;
}

module.exports = fuzzify;
