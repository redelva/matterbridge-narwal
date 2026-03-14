import { bridgedNode, MatterbridgeDynamicPlatform, MatterbridgeEndpoint, PlatformConfig, PlatformMatterbridge } from 'matterbridge';
import { RoboticVacuumCleaner } from 'matterbridge/devices';
import { AnsiLogger } from 'matterbridge/logger';
import { AreaNamespaceTag, UINT16_MAX, UINT32_MAX } from 'matterbridge/matter';
import {
  BridgedDeviceBasicInformation,
  Descriptor,
  PowerSource as PowerSourceCluster,
  RvcCleanMode,
  RvcOperationalState,
  RvcRunMode,
  ServiceArea,
} from 'matterbridge/matter/clusters';
import { isValidNumber, isValidString } from 'matterbridge/utils';

import NRWebsocket, {RoomAttr, RoomInfo, Status} from './narwalsocket.js';
import NRAPI from "./narwalapi.js";

const roomTagMap: Record<string, number> = {
  客厅: AreaNamespaceTag.LivingRoom.tag,
  主卧: AreaNamespaceTag.PrimaryBedroom.tag,
  次卧: AreaNamespaceTag.Bedroom.tag,
  儿童房: AreaNamespaceTag.KidsBedroom.tag,
  餐厅: AreaNamespaceTag.Dining.tag,
};

export type NarwalPlatformConfig = PlatformConfig & {
  mobile: string,
  password: string,
  whiteList: string[];
  blackList: string[];
  useInterval: boolean;
  enableServerRvc: boolean;
};

/**
 * This is the standard interface for Matterbridge plugins.
 * Each plugin should export a default function that follows this signature.
 *
 * @param {PlatformMatterbridge} matterbridge - The Matterbridge instance.
 * @param {AnsiLogger} log - The logger instance.
 * @param {PlatformConfig} config - The platform configuration.
 * @returns {MatterbridgeNarwalPlatform} The initialized platform.
 */
export default function initializePlugin(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: PlatformConfig): MatterbridgeNarwalPlatform {
  return new MatterbridgeNarwalPlatform(matterbridge, log, config as NarwalPlatformConfig);
}

export class MatterbridgeNarwalPlatform extends MatterbridgeDynamicPlatform {
  roboticVacuumList: Record<string,MatterbridgeEndpoint>|undefined;
  narwalWsList: Record<string,NRWebsocket>|undefined;
  narwalAPI: NRAPI | undefined;

  constructor(
    matterbridge: PlatformMatterbridge,
    log: AnsiLogger,
    override config: NarwalPlatformConfig,
  ) {
    super(matterbridge, log, config);

    // Verify that Matterbridge is the correct version
    if (this.verifyMatterbridgeVersion === undefined || typeof this.verifyMatterbridgeVersion !== 'function' || !this.verifyMatterbridgeVersion('3.6.0')) {
      throw new Error(
        `This plugin requires Matterbridge version >= "3.6.0". Please update Matterbridge from ${this.matterbridge.matterbridgeVersion} to the latest version in the frontend.`,
      );
    }

    this.log.info('Initializing platform:', this.config.name);
  }

  override async onStart(reason?: string) {
    this.log.info('onStart called with reason:', reason ?? 'none');

    // Wait for the platform to start
    await this.ready;

    this.narwalWsList = {}
    this.roboticVacuumList = {}

    this.narwalAPI = new NRAPI(this.config.mobile, this.config.password, this.log)
    const token = await this.narwalAPI.login()
    const devices = await this.narwalAPI.loadDevices()

    this.log.info("token",token,"devices",JSON.stringify(devices));

    for (const device of devices) {
      const socket = new NRWebsocket(
          device,
          token,
          this.log,
          async (data: Status|RoomAttr) => {
            this.log.info(JSON.stringify(data));
            this.roboticVacuumList && this.narwalWsList && this.narwalWsList[device.name] &&
            await this.updateVacuumFromNarwal(this.roboticVacuumList[device.name],data,this.narwalWsList[device.name]);
          },
          (_: Error) => {},
      );
      socket.connect();
      this.narwalWsList[device.name] = socket

      // await socket.getRoomAndOrder()

      // this.log.info("rooms",JSON.stringify(socket.getRooms()));
      // this.log.info("order",JSON.stringify(socket.getOrder()));

      // *********************** Create a robotic vacuum cleaner *****************************
      let roboticVacuum = new RoboticVacuumCleaner(
          // this.config.enableServerRvc ? 'Robot Vacuum Server' : 'Robot Vacuum',
          device.name,
          'YR1M216R1335C250698',
          this.config.enableServerRvc ? 'server' : undefined,
          1, // currentRunMode
          [
            { label: 'Idle', mode: 1, modeTags: [{ value: RvcRunMode.ModeTag.Idle }] },
            { label: 'Cleaning', mode: 2, modeTags: [{ value: RvcRunMode.ModeTag.Cleaning }] },
            { label: 'Mapping', mode: 3, modeTags: [{ value: RvcRunMode.ModeTag.Mapping }] },
          ], // supportedRunModes
          1, // currentCleanMode
          [
            { label: 'Vacuum', mode: 1, modeTags: [{ value: RvcCleanMode.ModeTag.Vacuum }] },
            { label: 'Mop', mode: 2, modeTags: [{ value: RvcCleanMode.ModeTag.Mop }] },
            // { label: 'Clean', mode: 3, modeTags: [{ value: RvcCleanMode.ModeTag.DeepClean }] },
          ], // supportedCleanModes
          null, // currentPhase
          null, // phaseList
          undefined, // operationalState
          undefined, // operationalStateList
          [
            {
              areaId: 1,
              mapId: 1,
              areaInfo: {
                locationInfo: {
                  locationName: '客厅',
                  floorNumber: 0,
                  areaType: AreaNamespaceTag.LivingRoom.tag
                }, landmarkInfo: null
              },
            },
            {
              areaId: 2,
              mapId: 1,
              areaInfo: {
                locationInfo: {locationName: '主卧', floorNumber: 0, areaType: AreaNamespaceTag.PrimaryBedroom.tag},
                landmarkInfo: null
              },
            },
            {
              areaId: 3,
              mapId: 1,
              areaInfo: {
                locationInfo: {locationName: '次卧', floorNumber: 1, areaType: AreaNamespaceTag.Bedroom.tag},
                landmarkInfo: null
              },
            },
            {
              areaId: 4,
              mapId: 1,
              areaInfo: {
                locationInfo: {
                  locationName: '儿童房',
                  floorNumber: 1,
                  areaType: AreaNamespaceTag.KidsBedroom.tag
                }, landmarkInfo: null
              },
            },
            {
              areaId: 5,
              mapId: 1,
              areaInfo: {
                locationInfo: {
                  locationName: '餐厅',
                  floorNumber: 1,
                  areaType: AreaNamespaceTag.Dining.tag
                }, landmarkInfo: null
              },
            },
          ], // supportedAreas
          [], // selectedAreas
          1, // currentArea
          [{
            mapId: 1,
            name: '1001',
          }], // supportedMaps
      );

      const roboticVacuumAdded = await this.addDevice(roboticVacuum);
      if (roboticVacuumAdded) {
        this.log.notice("roboticVacuum active",roboticVacuumAdded.construction.status);
        this.roboticVacuumList[device.name] = roboticVacuumAdded;
      }
    }
  }

  async updateVacuumFromNarwal(roboticVacuum: MatterbridgeEndpoint,  data: Status|RoomAttr,socket?:NRWebsocket): Promise<void> {
    if (!roboticVacuum) return;

    if ('clean_mode' in data) {
      const status = data as Status;
      await this.updateVacuumStatusFromNarwal(roboticVacuum, status)
      return
    }

    if ('clean_order' in data) {
      await this.updateVacuumRoomAttrFromNarwal(roboticVacuum, socket)
      return
    }
  }

  async updateVacuumStatusFromNarwal(roboticVacuum: MatterbridgeEndpoint, status: Status): Promise<void> {

    this.log.info(`Updating status from Narwal - clean_mode: ${status.clean_mode}, battery: ${status.battery_per}%`);

    if(roboticVacuum.construction.status !== "active"){
      this.log.info("roboticVacuum is not active",roboticVacuum.name);
      return
    }

    // Map Narwal status to Matter RVC states
    // Idle, 1
    // Cleaning, 2
    // Mapping, 3
    // SpotCleaning', 4
    let runMode = 1;
    let operationalState = RvcOperationalState.OperationalState.Docked;
    let batteryChargeState = PowerSourceCluster.BatChargeState.IsAtFullCharge;


    // cur_task_type: 4, 清洗拖布
    // cur_task_type:9 暂停 拖地

    // task_name: 'EntryBase', 召回机器人
    // task_name: 'SysMopOpt', 清洗拖布

    // if (status.working_progress > 0) {
    if (status.task_name.length > 0) {
      // Cleaning
      runMode = 2;
      operationalState = RvcOperationalState.OperationalState.Running;
    }

    if (status.task_name.length === 0 && status.task_queue.length > 0) {
      // Paused
      runMode = 2;
      operationalState = RvcOperationalState.OperationalState.Paused;
    }

    if (status.task_name.length === 0 && status.task_queue.length === 0) {
      // Idle
      runMode = 1;
      operationalState = RvcOperationalState.OperationalState.Docked;
    }

    if(status.task_name == "Explorer"){
      runMode = 3;
      operationalState = RvcOperationalState.OperationalState.Running;
    }

    if (status.charge_status) {
      runMode = 1;
      operationalState = RvcOperationalState.OperationalState.Running;
      if (status.battery_per === 100) {
        batteryChargeState = PowerSourceCluster.BatChargeState.IsAtFullCharge;
      } else {
        batteryChargeState = PowerSourceCluster.BatChargeState.IsCharging;
      }
    }else {
      batteryChargeState = PowerSourceCluster.BatChargeState.IsNotCharging;
      if(status.battery_per < 10 && status.task_name === 'EntryBase') {
        operationalState = RvcOperationalState.OperationalState.SeekingCharger;
      }
    }

    if (status.error_code > 0) {
      // error
      runMode = 1;
      operationalState = RvcOperationalState.OperationalState.Error;
    }

    let cleanMode = 1
    if(status.clean_mode===2) {
      // 扫地 vacuum
      cleanMode = 1
    }
    if(status.clean_mode===3) {
      //拖地 mop
      cleanMode = 2
    }
    const batteryLevel = Math.min(200, Math.max(0, status.battery_per * 2));

    // Update device attributes
    await roboticVacuum.setAttribute('RvcRunMode', 'currentMode', runMode, roboticVacuum.log);
    await roboticVacuum.setAttribute('RvcCleanMode', 'currentMode', cleanMode, roboticVacuum.log);
    await roboticVacuum.setAttribute('RvcOperationalState', 'operationalState', operationalState, roboticVacuum.log);
    await roboticVacuum.setAttribute(
      'RvcOperationalState',
      'operationalError',
      { errorStateId: status.error_code > 0 ? status.error_code : RvcOperationalState.ErrorState.NoError },
      roboticVacuum.log,
    );
    await roboticVacuum.setAttribute('PowerSource', 'batPercentRemaining', batteryLevel, roboticVacuum.log);
    await roboticVacuum.setAttribute('PowerSource', 'batChargeState', batteryChargeState, roboticVacuum.log);
  }

  async updateVacuumRoomAttrFromNarwal(roboticVacuum: MatterbridgeEndpoint, socket?:NRWebsocket): Promise<void> {
    this.log.info(`Updating rooms from Narwal`);

    if(!socket || !socket.getRooms()){
      return
    }

    const rooms = socket.getRooms()
    if(!rooms || rooms.length === 0){
      return
    }

    const areas = rooms.map((room: string, index: number) => {
      return {
        areaId: index,
        mapId: 1,
        areaInfo: {
          locationInfo: {
            locationName: room,
            floorNumber: 0,
            areaType: roomTagMap[room] ? roomTagMap[room] : AreaNamespaceTag.Bedroom.tag,
          },
          landmarkInfo: null,
        },
      };
    })
    await roboticVacuum?.setAttribute(ServiceArea.Cluster.id, 'supportedAreas', areas, roboticVacuum.log);
  }

  intervals: { interval: NodeJS.Timeout; callback: () => Promise<void> }[] = [];
  addInterval(callback: () => Promise<void>, intervalTime: number) {
    const interval = setInterval(callback, intervalTime);
    this.intervals.push({ interval, callback });
    return interval;
  }
  async executeIntervals(times: number, pauseTime: number = 100) {
    for (let i = 0; i < times; i++) {
      for (const { callback } of this.intervals) {
        await callback();
      }
      if (pauseTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, pauseTime));
      }
    }
  }
  clearIntervals() {
    this.intervals.forEach(({ interval }) => clearInterval(interval));
    this.intervals = [];
  }

  override async onConfigure() {
    await super.onConfigure();
    this.log.info('onConfigure called');

    if (this.config.useInterval) {
      this.addInterval(async () => {
        for (const [name, narwalWs] of Object.entries(this.narwalWsList??{})) {
          narwalWs?.fetchStatus();
        }
      }, 10 * 1000);
    }

    // Set initial state for robotic vacuum

    for (const [name, roboticVacuum] of Object.entries(this.roboticVacuumList??{})) {
      this.log.info('start to configure', name, roboticVacuum.id, roboticVacuum.name);
      if (roboticVacuum) {
        if (this.config.enableServerRvc) {
          this.log.notice('RVC is in server mode so it has its own QR code (it shows in the "Devices" panel of the Home page)');
        }

        roboticVacuum?.addCommandHandler('pause', async () => {
          this.log.info("'pause' handler called - NarwalVac");
          if(this.narwalWsList){
            this.narwalWsList[name].pauseCleaning();
          }
        });

        roboticVacuum?.addCommandHandler('stop', async () => {
          this.log.info("'stop' handler called - NarwalVac", name);
          this.narwalWsList && this.narwalWsList[name].stopCleaning();
        });

        roboticVacuum?.addCommandHandler('start', async () => {
          this.log.info("'start' handler called - NarwalVac");
          this.narwalWsList && this.narwalWsList[name].startCleaning();
        });

        roboticVacuum?.addCommandHandler('resume', async () => {
          this.log.info("'resume' handler called - NarwalVac");
          this.narwalWsList && this.narwalWsList[name].startCleaning();
        });

        roboticVacuum?.addCommandHandler('goHome', async () => {
          this.log.info("'goHome' handler called - NarwalVac");
          this.narwalWsList && this.narwalWsList[name].stopCleaning();
          setTimeout(()=>{
            this.narwalWsList && this.narwalWsList[name].goToDock();
          }, 5000)

        });

        roboticVacuum?.addCommandHandler('selectAreas', async ({ request }) => {
          const { newAreas } = request as ServiceArea.SelectAreasRequest;

          for (const area of newAreas) {
            if(this.narwalWsList){
              const rooms = this.narwalWsList[name].getRooms()
              if(rooms){
                if (area > rooms.length) {
                  this.log.error('MatterbridgeServiceAreaServer selectAreas called with unsupported area:', area);
                  return;
                }
              }
            }
          }

          await roboticVacuum?.setAttribute(ServiceArea.Cluster.id, 'currentArea', newAreas[0],roboticVacuum.log);
          await roboticVacuum?.setAttribute(ServiceArea.Cluster.id, 'selectedAreas', newAreas, roboticVacuum.log);
          this.log.info(`'selectAreas' handler called. Selected areas: ${newAreas?.join(', ')}`);
        });

        roboticVacuum?.addCommandHandler('changeToMode', async ({ request }) => {
          this.log.info(`'changeToMode' handler called - RoboVac. New mode = ${request.newMode}`); // 1 == Idle, 2 == Running
          if (request.newMode === 2) {
            // Start vacuuming or Resume if paused
            this.narwalWsList && this.narwalWsList[name].startCleaning();
          }
        });

        roboticVacuum?.addCommandHandler('identify', () => {
          this.log.info(`Identify device${this.name}`);
        });

        await roboticVacuum.setAttribute('PowerSource', 'batPercentRemaining', 200, roboticVacuum.log);
        await roboticVacuum.setAttribute('PowerSource', 'batChargeState', PowerSourceCluster.BatChargeState.IsAtFullCharge, roboticVacuum.log);
        await roboticVacuum.setAttribute('PowerSource', 'batVoltage', 6000, roboticVacuum.log);
        await roboticVacuum.setAttribute('RvcRunMode', 'currentMode', 1, roboticVacuum.log); // Idle
        await roboticVacuum.setAttribute('RvcCleanMode', 'currentMode', 1, roboticVacuum.log); // Vacuum
        await roboticVacuum.setAttribute('RvcOperationalState', 'operationalState', RvcOperationalState.OperationalState.Docked, roboticVacuum.log);
        await roboticVacuum.setAttribute('RvcOperationalState', 'operationalError', { errorStateId: RvcOperationalState.ErrorState.NoError }, roboticVacuum.log);
      }
    }
  }

  override async onShutdown(reason?: string) {
    this.clearIntervals();
    for (const [name, narwalWs] of Object.entries(this.narwalWsList??{})) {
      narwalWs.disconnect();
    }
    await super.onShutdown(reason);
    this.log.info('onShutdown called with reason:', reason ?? 'none');
    if (this.config.unregisterOnShutdown === true) await this.unregisterAllDevices(500);
  }

  async addDevice(device: MatterbridgeEndpoint): Promise<MatterbridgeEndpoint | undefined> {
    if (!device.serialNumber || !device.deviceName) return;
    this.setSelectDevice(device.serialNumber, device.deviceName, undefined, 'hub');
    if (this.validateDevice(device.deviceName)) {
      device.softwareVersion = parseInt(this.version.replace(/\D/g, ''));
      device.softwareVersionString = this.version === '' ? 'Unknown' : this.version;
      device.hardwareVersion = parseInt(this.matterbridge.matterbridgeVersion.replace(/\D/g, ''));
      device.hardwareVersionString = this.matterbridge.matterbridgeVersion;
      device.softwareVersion = isValidNumber(device.softwareVersion, 0, UINT32_MAX) ? device.softwareVersion : undefined;
      device.softwareVersionString = isValidString(device.softwareVersionString) ? device.softwareVersionString.slice(0, 64) : undefined;
      device.hardwareVersion = isValidNumber(device.hardwareVersion, 0, UINT16_MAX) ? device.hardwareVersion : undefined;
      device.hardwareVersionString = isValidString(device.hardwareVersionString) ? device.hardwareVersionString.slice(0, 64) : undefined;
      const options = device.getClusterServerOptions(BridgedDeviceBasicInformation.Cluster.id);
      if (options) {
        options.softwareVersion = device.softwareVersion || 1;
        options.softwareVersionString = device.softwareVersionString || '1.0.0';
        options.hardwareVersion = device.hardwareVersion || 1;
        options.hardwareVersionString = device.hardwareVersionString || '1.0.0';
      }
      // We need to add bridgedNode device type and BridgedDeviceBasicInformation cluster for single class devices that doesn't add it in childbridge mode.
      if (device.mode === undefined && !device.deviceTypes.has(bridgedNode.code)) {
        device.deviceTypes.set(bridgedNode.code, bridgedNode);
        const options = device.getClusterServerOptions(Descriptor.Cluster.id);
        if (options) {
          const deviceTypeList = options.deviceTypeList as { deviceType: number; revision: number }[];
          if (!deviceTypeList.find((dt) => dt.deviceType === bridgedNode.code)) {
            deviceTypeList.push({ deviceType: bridgedNode.code, revision: bridgedNode.revision });
          }
        }
        device.createDefaultBridgedDeviceBasicInformationClusterServer(
          device.deviceName,
          device.serialNumber,
          device.vendorId,
          device.vendorName,
          device.productName,
          device.softwareVersion,
          device.softwareVersionString,
          device.hardwareVersion,
          device.hardwareVersionString,
        );
      }

      await this.registerDevice(device);
      return device;
    } else {
      return undefined;
    }
  }
}
