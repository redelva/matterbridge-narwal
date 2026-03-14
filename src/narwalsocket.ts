/**
 * Narwal WebSocket client for communicating with zhinengtuodi.com servers
 *
 * @file narwalapi.ts
 * @license Apache-2.0
 */

import CryptoJS from 'crypto-js';
import { AnsiLogger } from 'matterbridge/logger';
import { v4 as uuidv4 } from 'uuid';
import WS from 'ws';
import axios from 'axios';
import {Device} from "./narwalapi.js";

// Narwal API Response wrapper
export interface Response<T> {
  request_id: string;
  service: string;
  machineId: string;
  code: number;
  result: T;
}
export type RoomInfo = {
  "name": string;
  "room_id": number;
  "type": number;
}
export type RoomOrder = {
  mop_default_order: number[];
  sweep_default_order: number[];
}
export type RoomAttr = {
  map_id:string;
  room_attr:{
    attr:RoomInfo[]
  };
  clean_order: RoomOrder;
}
export type Status = {
  battery_per: number; // 100,
  charge_status: boolean; // false,
  clean_bucket: number; // 0,
  clean_mode: number; // 2,
  clean_order: number[]; // [1, 0, 2, 3, 4],
  cleaned_area: number; // 0.6011999845504761,
  cliff_shield_mode: number; // 0,
  cur_task_type: number; // 2,
  dust_box: number; // 1,
  error_code: number; // 0,
  fan_status: number; // 0,
  flume_status: number; // 0,
  humidity: number[]; // [],
  language: number; // 0,
  main_task: number; // 2,
  mode_strength: string; // normal_mode,
  ovf_status: number; // 0,
  robot_mode: string; // HighLand,
  robot_status: number; // 300,
  slop_bucket: number; // 0,
  station_contact: boolean; // false,
  station_sub_mode: number; // 103,
  task_name: string; // RoomClean,
  task_queue: number[]; // [5, 14, 10],
  task_st_time: string; // 2025 - 03 - 28 19: 53: 06,
  volume: number; // 1,
  work_status: number; // 1,
  working_progress: number; // 1.0
};

const MD5 = CryptoJS.MD5;
const AES = CryptoJS.AES;
const UTF8 = CryptoJS.enc.Utf8;
const SECRET_KEY = 'narwel_app_team0';

const RoomMap:string[] = ["主卧","次卧","客厅","厨房","浴室","卫生间","阳台","餐厅","衣帽间","走廊","书房","儿童房","娱乐室","杂物间","其他","自定义"]
const DEFAULT_WS_URL = 'wss://ws.zhinengtuodi.com/app_websocket';

export type DataCallback = (data: Status|RoomAttr) => void;
export type ErrorCallback = (error: Error) => void;

export class NRWebsocket {
  private socket: WS | undefined;
  private lastStatus: Status | undefined;
  private readonly log: AnsiLogger;
  private device: Device;
  private dataCallback: DataCallback | undefined;
  private errorCallback: ErrorCallback | undefined;
  private rooms: Array<string>|undefined;
  private mapId: number|undefined;
  private order: RoomOrder|undefined;
  private reconnectTimeout: NodeJS.Timeout | undefined;
  private heartbeatTimeout: NodeJS.Timeout | undefined;
  private readonly RECONNECT_DELAY = 5000;

  private token:string;

  constructor(device:Device, token:string,log: AnsiLogger, dataCallback?: DataCallback, errorCallback?: ErrorCallback) {
    this.dataCallback = dataCallback;
    this.errorCallback = errorCallback;
    this.device = device;
    this.token=token;
    this.log = log;
  }

  appAuth():string{
    return this.encrypt({
      "machine_id": this.device.machineId,
      "token": this.token,
      "version": "Av2"
    })
  }

  /**
   * Connect to the Narwal WebSocket server
   */
  connect(): void {
    try {
      this.log.info(`Connecting to Narwal server: ${DEFAULT_WS_URL}`);
      this.socket = new WS(DEFAULT_WS_URL, {
        headers: {
          'User-Agent': 'Dart/3.3 (dart:io)',
          'app-auth': this.appAuth(),// DEFAULT_AUTH_HEADER,
        },
      });

      this.socket.on('open', () => {
        this.log.info('Connected to Narwal server');
        // Clear any existing reconnect timeout
        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout);
          this.reconnectTimeout = undefined;
        }
        // Fetch initial status
        this.fetchStatus();
        this.getRoomAndOrder()
        this.heartbeatTimeout = setInterval(() => {
          this.heartbeat()
        }, 30000);
      });

      this.socket.on('message', (data: WS.Data) => {
        try {
          const response = this.decrypt<Response<Status>|Response<RoomAttr>>(data.toString());
          // this.log.debug('Received message decrypted', response.service);
          this.handleResponse(response);
        } catch (error) {
          this.log.error('Failed to decrypt message:', error);
          this.errorCallback?.(error as Error);
        }
      });

      this.socket.on('close', (code: number, reason: Buffer) => {
        this.log.warn('Disconnected from Narwal server, code: ' + code + ',reason: ' + reason);
        this.socket = undefined;
        this.scheduleReconnect();
      });

      this.socket.on('error', (error) => {
        this.log.error('WebSocket error:', error);
        this.errorCallback?.(error as Error);
        this.socket?.close();
      });
    } catch (error) {
      this.log.error('Failed to connect:', error);
      this.errorCallback?.(error as Error);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }
    if (this.heartbeatTimeout) {
      clearInterval(this.heartbeatTimeout);
      this.heartbeatTimeout = undefined;
    }
    if (this.socket) {
      this.log.info('Disconnecting from Narwal server');
      this.socket.close();
      this.socket = undefined;
    }
  }

  heartbeat(): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.ping()
    }
  }

  isConnected(): boolean {
    return this.socket?.readyState === WS.OPEN;
  }

  getLastStatus(): Status | undefined {
    return this.lastStatus;
  }

  getRooms():Array<string> |undefined{
    return this.rooms
  }

  getOrder():RoomOrder |undefined{
    return this.order
  }

  /**
   * Fetch current status from the device
   */
  fetchStatus(): void {
    if (!this.isConnected()) {
      this.log.warn('Cannot fetch status: not connected');
      return;
    }

    this.send({
      request_id: uuidv4(),
      service: '/pita/info/all',
      machine_id: this.device.machineId,
      params: '{}',
    });
  }

  /**
   * Start cleaning
   */
  startCleaning(): void {
    let orders = [1, 0, 2, 3, 4]

    if(this.order && this.lastStatus){
      //扫地
      if(this.lastStatus?.clean_mode === 3){
        orders= this.order?.sweep_default_order
      }
      //拖地 mop
      if(this.lastStatus?.clean_mode === 2){
        orders= this.order?.mop_default_order
      }
    }

    this.sendCommand(3, {
      clean_order: orders,
      floor_type: [],
    });
  }

  /**
   * Pause cleaning
   */
  pauseCleaning(): void {
    this.sendCommand(3);
  }

  /**
   * Stop cleaning
   */
  stopCleaning(): void {
    this.sendCommand(4);
  }

  /**
   * Return to dock
   */
  goToDock(): void {
    this.sendCommand(1);
  }

  /**
   * identify
   */
  identify(): void {
    // /pita/other/pos_info
    this.send({
      request_id: uuidv4(),
      service: '/pita/other/pos_info',
      machine_id: this.device.machineId,
      params: '{}',
    });
  }

  private getRoomAndOrder(): void{
    this.send({
        request_id: uuidv4(),
        machine_id: this.device.machineId,
        service: "/pita/plan_map/get",
        params: {
          "operations": [
            "room_attr","clean_order","map_data"
          ]
        }
    })
  }

  // Private methods

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return;

    this.log.info(`Will reconnect in ${this.RECONNECT_DELAY}ms`);
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = undefined;
      this.connect();
    }, this.RECONNECT_DELAY);
  }

  private handleResponse(response: Response<Status>| Response<RoomAttr>): void {
    if (response.code === 0 && response.service === '/pita/info/all' && 'battery_per' in response.result) {
      // this.log.debug('Received status:', response.result);
      this.lastStatus = response.result;
      this.dataCallback?.(response.result);
    } if (response.code === 0 && response.service === '/pita/plan_map/get' && 'room_attr' in response.result) {
      this.rooms = response.result.room_attr.attr.map((a:RoomInfo) => {
        return a.name.length>0? a.name: RoomMap[a.type]
      })
      this.mapId = parseFloat(response.result.map_id)
      this.dataCallback?.(response.result);
      this.order = response.result.clean_order;
    } else if (response.code !== 0) {
      this.log.error('Error response:', response.code, response.service);
      this.errorCallback?.(new Error(response.code.toString()));
    }
  }

  private sendCommand(cmd: number, params?: Record<string, unknown>): void {
    const payload: Record<string, unknown> = {
      request_id: uuidv4(),
      machine_id: this.device.machineId,
      service: '/pita_clean_system/command',
      params: {
        cmd,
        ...params,
      },
    };
    this.send(payload);
  }

  private send(cmd: object, cb?:ErrorCallback): void {
    if (this.socket?.readyState === WS.OPEN) {
      const encrypted = this.encrypt(cmd);
      this.socket.send(encrypted);
      this.log.debug('Sent:', cmd);
    } else {
      this.log.warn('Cannot send: socket not open');
    }
  }

  private encrypt(cmd: object): string {
    const key = UTF8.parse(SECRET_KEY);
    const srcs = UTF8.parse(JSON.stringify(cmd));
    const encrypted = AES.encrypt(srcs, key, {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.ZeroPadding,
    });

    return encrypted.toString();
  }

  private decrypt<T>(content: string): T {
    const key = UTF8.parse(SECRET_KEY);
    const decrypt = AES.decrypt(content, key, {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.ZeroPadding,
    });
    const decryptedContent = UTF8.stringify(decrypt)
      .toString()
      .replace(/^[\s\uFEFF\xA0\0]+|[\s\uFEFF\xA0\0]+$/g, '');
    return JSON.parse(decryptedContent);
  }
}

export default NRWebsocket;
