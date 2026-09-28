const { execFileSync } = require('node:child_process')

function readCommitHash() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    commitHash: readCommitHash()
  }
})
