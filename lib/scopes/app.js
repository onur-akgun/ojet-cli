/**
  Copyright (c) 2015, 2019, Oracle and/or its affiliates.
  The Universal Permissive License (UPL), Version 1.0
*/
'use strict';

/**
 * ## Dependencies
 */
// Node
const fs = require('fs');
const path = require('path');

// 3rd party
const env = require('yeoman-environment').createEnv();

// Oracle
const config = require('../../config');
const CONSTANTS = require('../utils.constants');
const paths = require('../utils.paths');
const pckg = require('../../package.json');
const tooling = require('../tooling');
const utils = require('../utils');

/**
 * ## Variables
 */
const cwd = process.cwd();
const configPath = path.resolve(cwd, CONSTANTS.APP_CONFIG_JSON);

/**
 * # App
 *
 * @public
 */
const app = module.exports;

env.on('error', (error) => {
  if (utils.isTestEnv()) {
    utils.log(error);
  }
  utils.log.error(error);
});

/**
 * ## create
 *
 * @public
 * @param {string} [parameter]
 * @param {Object} [options]
 */
app.create = function (parameter, options) {
  const opts = options;
  env.lookup(() => {
    if (opts && utils.hasProperty(opts, 'hybrid')) {
      // Deleting 'hybrid' flag
      delete opts.hybrid;
      _envRun('hybrid', parameter, opts);
    } else {
      // Deleting 'web' flag
      if (opts && utils.hasProperty(opts, 'web')) {
        delete opts.web;
      }
      _envRun('app', parameter, opts);
    }
  });
};

/**
 * ## delegateToGenerator
 *
 * @public
 * @param {string} generator
 * @param {string} [parameter]
 * @param {Object} [options]
 */
app.delegateToGenerator = function (generator, parameter, options) {
  env.lookup(() => {
    _envRun(generator, parameter, options);
  });
};

/**
 * ## restore
 *
 * @public
 */
app.restore = function () {
  // if the project contains cordova's config.xml, consider it to be a hybrid; otherwise web
  const cordovaDir = paths.getConfiguredPaths(process.cwd()).stagingHybrid;
  const isHybrid = fs.existsSync(path.resolve(cordovaDir, CONSTANTS.CORDOVA_CONFIG_XML));
  const appType = CONSTANTS.APP_TYPE;
  const restoreType = isHybrid ? appType.HYBRID : appType.WEB;

  if (restoreType === 'web') {
    _restoreWeb();
  } else {
    _restoreHybrid();
  }
};

/**
 * ## _restoreWeb
 *
 * @private
 */
function _restoreWeb() {
  _npmInstall()
    .then(_writeOracleJetConfigFile)
    .then(_addComponents)
    .then(_runAfterAppRestoreHook)
    .then(() => {
      utils.log.success('Restore complete');
    })
    .catch((error) => {
      utils.log(error);
    });
}

/**
 * ## _npmInstall
 *
 * @private
 */
function _npmInstall() {
  utils.log('Performing \'npm install\' may take a bit.');
  return utils.spawn('npm', ['install']);
}

/**
 * ## _addComponents
 *
 * @private
 */
function _addComponents() {
  const configJson = utils.readJsonAndReturnObject(configPath);
  const composites = configJson.composites;
  if (utils.isObjectEmpty(composites)) {
    return utils.log('No components to add.');
  }
  utils.log('Adding components.');
  const components = [];
  Object.keys(composites).forEach((key) => {
    components.push(`${key}@${composites[key]}`);
  });

  const toolingModule = utils.loadTooling();
  return toolingModule.add(config.tasks.add.scopes.component.name, components);
}

/**
 * ## _writeOracleJetConfigFile
 *
 * @private
 */
function _writeOracleJetConfigFile() {
  return new Promise((resolve) => {
    utils.log(`Checking '${CONSTANTS.APP_CONFIG_JSON}'config file.`);

    fs.stat(configPath, (err) => {
      const generatorVersion = pckg.version;
      if (err) {
        utils.log('No config file. Adding the default.');
        fs.writeFileSync(configPath, JSON.stringify(generatorVersion, null, 2));
      } else {
        utils.log(`'${CONSTANTS.APP_CONFIG_JSON}' file exists. Adding/updating version.`);
        const configJson = utils.readJsonAndReturnObject(configPath);
        configJson.generatorVersion = generatorVersion;
        fs.writeFileSync(configPath, JSON.stringify(configJson, null, 2));
      }
      resolve();
    });
  });
}

/**
 * ## _restoreHybrid
 *
 * @private
 */
function _restoreHybrid() {
  _npmInstall()
    .then(_writeOracleJetConfigFile)
    .then(_addComponents)
    .then(_invokeCordovaPrepare)
    .then(_runAfterAppRestoreHook)
    .then(() => {
      utils.log.success('Restore complete');
    })
    .catch((error) => {
      utils.log(error);
    });
}

/**
 * ## _invokeCordovaPrepare
 *
 * @private
 */
function _invokeCordovaPrepare() {
  const hybrid = paths.getConfiguredPaths(cwd).stagingHybrid;
  utils.ensureDir(path.join(hybrid, 'www'));

  const cmdOpts = { cwd: hybrid, stdio: [0, 'pipe', 'pipe'], maxBuffer: 1024 * 20000 };
  // Not using default utils.exec as we need to handle error specially (hid logs about index.html)
  return new Promise((resolve, reject) => {
    utils.exec('cordova prepare', cmdOpts, (error) => {
      // When www/index.html files are missing, cordova reports error
      if (error && !/index\.html/.test(error)) {
        reject(error);
      }
      resolve();
    });
  });
}

/**
 * ## _runAfterAppRestoreHook
 *
 * @private
 */
function _runAfterAppRestoreHook() {
  return new Promise((resolve, reject) => {
    // Get hooks config
    const hooksConfig = _getHooksConfigObj();

    // Get after_app_prepare hook's path
    const hookPath = hooksConfig.after_app_restore;
    if (hookPath && fs.existsSync(path.resolve(hookPath))) {
      const hook = require(path.resolve(hookPath)); // eslint-disable-line
      // Execute hook
      hook()
        .then(() => resolve())
        .catch(err => reject(err));
    } else {
      utils.log.warning('Hook \'after_app_restore\' not defined.');
      resolve();
    }
  });
}

/**
 * ## _getHooksConfigObj
 * Reads the hooks.json file
 *
 * @private
 */
function _getHooksConfigObj() {
  const configFilePath = path.resolve(CONSTANTS.PATH_TO_HOOKS_CONFIG);
  if (fs.existsSync(configFilePath)) {
    const hooksObj = utils.readJsonAndReturnObject(configFilePath);
    return hooksObj.hooks || {};
  }
  return {};
}

/**
 * ## runTooling
 *
 * @public
 * @param {string} task
 * @param {string} parameter
 * @param {Object} [options]
 */
app.runTooling = function (task, scope, parameter, options) {
  // Refuse platform flag
  if (utils.hasProperty(options, 'platform')) {
    utils.log.error('Flag \'--platform\' is not supported. Use platform name as parameter e.g. \'ojet serve ios.\'');
  }

  if (utils.isCwdJetApp()) {
    tooling(task, scope, parameter, options);
  } else {
    utils.log.error(utils.toNotJetAppMessage());
  }
};

/**
 * # _envRun
 *
 * @private
 * @param {string} generator
 * @param {string} [parameter]
 * @param {Object} [options]
 */
function _envRun(generator, parameter, options) {
  const gen = `@oracle/oraclejet:${generator}`;
  const cmdToRun = parameter ? `${gen} ${parameter}` : gen;

  env.run(cmdToRun, options, (error) => {
    if (error) {
      utils.log.error(error);
    }
  });
}
