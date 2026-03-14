const MATTER_PORT = 6000;
const NAME = 'Platform';
const HOMEDIR = path.join('jest', NAME);

process.argv = ['node', 'platform.test.js', '-novirtual', '-frontend', '0', '-homedir', HOMEDIR, '-port', MATTER_PORT.toString()];

import path from 'node:path';

import { jest } from '@jest/globals';
import { MatterbridgeEndpoint } from 'matterbridge';
import {
  addBridgedEndpointSpy,
  addMatterbridgePlatform,
  createMatterbridgeEnvironment,
  destroyMatterbridgeEnvironment,
  loggerLogSpy,
  matterbridge,
  removeAllBridgedEndpointsSpy,
  removeBridgedEndpointSpy,
  setupTest,
  startMatterbridgeEnvironment,
  stopMatterbridgeEnvironment,
} from 'matterbridge/jestutils';
import { AnsiLogger, LogLevel, TimestampFormat } from 'matterbridge/logger';

import initializePlugin, { MatterbridgeNarwalPlatform, NarwalPlatformConfig } from './module.js';

// Setup the test environment
setupTest(NAME, false);

describe('MatterbridgeNarwalPlatform', () => {
  let dynamicPlatform: MatterbridgeNarwalPlatform;
  const log = new AnsiLogger({ logName: NAME, logTimestampFormat: TimestampFormat.TIME_MILLIS, logLevel: LogLevel.DEBUG });

  const config: NarwalPlatformConfig = {
    name: 'matterbridge-narwal',
    type: 'DynamicPlatform',
    version: '1.0.0',
    whiteList: [],
    blackList: [],
    debug: true,
    unregisterOnShutdown: false,
    useInterval:true,
    enableServerRvc: true,
    mobile:"",
    password:"",
  };

  beforeAll(async () => {
    await createMatterbridgeEnvironment(NAME);
    await startMatterbridgeEnvironment(MATTER_PORT);
  });

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await stopMatterbridgeEnvironment();
    await destroyMatterbridgeEnvironment();
    // Restore all mocks
    jest.restoreAllMocks();
  });

  it('should return an instance of the platform', async () => {
    dynamicPlatform = initializePlugin(matterbridge, log, config);
    expect(dynamicPlatform).toBeInstanceOf(MatterbridgeNarwalPlatform);
    await dynamicPlatform.onShutdown();
  });

  it('should throw error in load when version is not valid', () => {
    matterbridge.matterbridgeVersion = '1.5.0';
    expect(() => new MatterbridgeNarwalPlatform(matterbridge, log, config)).toThrow(
      'This plugin requires Matterbridge version >= "3.6.0". Please update Matterbridge from 1.5.0 to the latest version in the frontend.',
    );
    matterbridge.matterbridgeVersion = '3.6.0';
  });

  it('should initialize platform with config name and set the default config', () => {
    dynamicPlatform = new MatterbridgeNarwalPlatform(matterbridge, log, config);
    addMatterbridgePlatform(dynamicPlatform);
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, 'Initializing platform:', config.name);
    expect(config.whiteList).toEqual([]);
    expect(config.blackList).toEqual([]);
  });

  it('should call onShutdown with reason and remove the devices', async () => {
    config.unregisterOnShutdown = true;
    await dynamicPlatform.onShutdown('Test reason');
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, 'onShutdown called with reason:', 'Test reason');
    expect(removeBridgedEndpointSpy).toHaveBeenCalledTimes(0);
    expect(removeAllBridgedEndpointsSpy).toHaveBeenCalledTimes(1);
    config.unregisterOnShutdown = false;
  });

  it('should call onStart without reason and add the robotic vacuum', async () => {
    config.whiteList = [];
    config.blackList = [];
    dynamicPlatform = new MatterbridgeNarwalPlatform(matterbridge, log, config);
    addMatterbridgePlatform(dynamicPlatform);

    await dynamicPlatform.onStart();
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, 'onStart called with reason:', 'none');
    expect(addBridgedEndpointSpy).toHaveBeenCalledTimes(1);
  });

  it('should call onStart with reason and add the robotic vacuum', async () => {
    await dynamicPlatform.onStart('Test reason');
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, 'onStart called with reason:', 'Test reason');
    expect(addBridgedEndpointSpy).toHaveBeenCalledTimes(1);
  });

  it('should call onConfigure', async () => {
    await dynamicPlatform.onConfigure();
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, 'onConfigure called');
  });

  it('should call onShutdown with reason', async () => {
    await dynamicPlatform.onShutdown('Test reason');
    expect(loggerLogSpy).toHaveBeenCalledWith(LogLevel.INFO, 'onShutdown called with reason:', 'Test reason');
    expect(removeBridgedEndpointSpy).toHaveBeenCalledTimes(0);
    expect(removeAllBridgedEndpointsSpy).toHaveBeenCalledTimes(0);
  });
});
