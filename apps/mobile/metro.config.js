const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

// Metro has to be told about the monorepo, otherwise it cannot resolve @ego/core.
config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules')
]

// Android draws its own emoji. Every Text the app imports from react-native draws Apple's pictures instead.
const emojiDir = path.resolve(projectRoot, 'lib/emoji')
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const origin = context.originModulePath
  if (moduleName === 'react-native' && platform === 'android' && !origin.startsWith(emojiDir + path.sep) && !origin.includes(`${path.sep}node_modules${path.sep}`)) {
    return { type: 'sourceFile', filePath: path.join(emojiDir, 'react-native.ts') }
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = withNativeWind(config, { input: './global.css' })
