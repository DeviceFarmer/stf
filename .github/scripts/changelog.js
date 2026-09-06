//
// Fold one release's generated notes into CHANGELOG.md.
//
// GitHub's generate-notes API returns a "## What's Changed" list, an optional
// "## New Contributors" list, and a "**Full Changelog**" link. All three are kept,
// with the sub-headings dropped to h3 so the version headings keep h2.
//
// usage: node changelog.js <CHANGELOG.md> <version> <notes-file>
//        node changelog.js --extract <CHANGELOG.md> <version>
//
// The extract mode prints one version's section back out, without its heading.
// Release uses it for the GitHub release body so the body and the changelog
// cannot drift, and so an edit made while reviewing the release pull request
// reaches both.
//

var fs = require('fs')



// The API returns CRLF, so every line would keep a trailing \r and no heading
// would ever match.
function split(notes) {
  return notes.replace(/\r\n/g, '\n').split('\n')
}

// Collects the bullets under one "## <heading>" until the next h2.
function section(lines, heading) {
  var start = lines.indexOf('## ' + heading)
  if (start < 0) {
    return []
  }

  var out = []
  for (var i = start + 1; i < lines.length; i++) {
    var line = lines[i].trim()
    if (line.indexOf('## ') === 0) {
      break
    }
    if (line.indexOf('* ') === 0) {
      out.push(line)
    }
  }
  return out
}

function entries(notes) {
  return section(split(notes), "What's Changed")
}

function contributors(notes) {
  return section(split(notes), 'New Contributors')
}

// The compare link is a single line rather than a section.
function fullChangelog(notes) {
  return split(notes).filter(function(line) {
    return line.indexOf('**Full Changelog**:') === 0
  })[0] || ''
}

function insert(changelog, section) {
  return '# Changelog\n\n' + section + changelog.replace(/^# Changelog\n+/, '')
}

// Owned here rather than in the workflow so both modes agree on what a version
// heading looks like.
function heading(version) {
  return '## ' + version + ' ('
}

// Everything between this version's heading and the next h2.
function extract(changelog, version) {
  var lines = changelog.split('\n')
  var start = -1
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf(heading(version)) === 0) {
      start = i
      break
    }
  }
  if (start < 0) {
    console.error('CHANGELOG.md has no ' + version + ' section')
    process.exit(1)
  }

  var out = []
  for (var j = start + 1; j < lines.length; j++) {
    if (lines[j].indexOf('## ') === 0) {
      break
    }
    out.push(lines[j])
  }
  return out.join('\n').replace(/^\n+/, '').replace(/\n+$/, '')
}

function main() {
  if (process.argv[2] === '--extract') {
    var source = process.argv[3]
    console.log(extract(fs.readFileSync(source, 'utf8'), process.argv[4]))
    return
  }

  var file = process.argv[2]
  var version = process.argv[3]
  var date = new Date().toISOString().slice(0, 10)
  var notes = fs.readFileSync(process.argv[4], 'utf8')

  var changelog = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '# Changelog\n'
  if (changelog.indexOf('\n' + heading(version)) >= 0) {
    console.error('CHANGELOG.md already has a ' + version + ' section')
    process.exit(1)
  }

  var lines = entries(notes)
  if (!lines.length) {
    console.error('no "## What\'s Changed" entries in the generated notes')
    process.exit(1)
  }

  // Version headings own h2 here, so the sub-sections drop to h3 rather than
  // reading as separate releases.
  var body = heading(version) + date + ')\n\n' + lines.join('\n') + '\n'

  var newcomers = contributors(notes)
  if (newcomers.length) {
    body += '\n### New Contributors\n\n' + newcomers.join('\n') + '\n'
  }

  var compare = fullChangelog(notes)
  if (compare) {
    body += '\n' + compare + '\n'
  }

  fs.writeFileSync(file, insert(changelog, body + '\n'))
  console.log('added ' + lines.length + ' entries under ' + version)
}

if (require.main === module) {
  main()
}

