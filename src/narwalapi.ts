/**
 * Narwal WebSocket client for communicating with zhinengtuodi.com servers
 *
 * @file narwalsocket.ts
 * @license Apache-2.0
 */

import CryptoJS from 'crypto-js';
import { AnsiLogger } from 'matterbridge/logger';
import { v4 as uuidv4 } from 'uuid';
import WS from 'ws';
import axios from 'axios';

// Device configuration
export interface Device {
  machineId: string;
  name: string;
  snNumber:string;
  model:string;
}

// Narwal API Response wrapper
export interface Response<T> {
  request_id: string;
  service: string;
  machineId: string;
  code: number;
  result: T;
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

const AES = CryptoJS.AES;
const UTF8 = CryptoJS.enc.Utf8;
const SECRET_KEY = 'narwel_app_team0';

const DEFAULT_WS_URL = 'wss://ws.zhinengtuodi.com/app_websocket';
const DEFAULT_AUTH_HEADER =
  '0MAIpIbQDsFJNxn3rwZxZIn55ZS5Sczyiyh/kg5WZzPSnNWBZF+Frdg/CRETuJkjT9WBXQd8wrghQAnl4Oqe8Oc34CeutM+R53ChMw7K976xvg/ectqgHtt65gb6HoGJlnaW+AtCRT77fNTX9849FVkmLIICzWHtPpb1eCS4NYrFPGwREbU4LeD3DsDczTuw0ZA5wwZuRZyUedTSBO3YdNNul/VbJcZ0fum/3OTXZq53k+O77aSXPCCS7FOgEsmpSW27Kew68i80wu3GRoZmCHoq3b4Ir4JkmDZB9kviqwe0qr64dpIYdKMBdYO6Y3euyB1NCFwWS5rwv+r7oGMQUVvA4KM8kWm7Ln4ztGgNxNc=';

export type StatusCallback = (status: Status) => void;
export type ErrorCallback = (error: Error) => void;

export class NRAPI {
  private readonly log: AnsiLogger;
  private token:string|undefined;
  private readonly mobile:string;
  private readonly password:string;

  constructor(mobile:string, password:string,log: AnsiLogger) {
    this.log = log;
    this.mobile = mobile;
    this.password = password;
  }

  async login():void {
    const resp = await axios.post('https://cn-idass.narwaltech.com/user-authentication-server/v2/login/loginByPw',{
      "area_code": "86",
      "mobile": `${this.mobile}`,
      "password": `${this.password}`,
      "last_login_system": 2,
      "last_login_app_version": "2.6.80",
      "terminal_brand": "iPhone",
      "terminal_device_name": "iPhone18,3",
      "terminal_model": "iPhone18,3",
      "terminal_version": null,
      "terminal_system_name": "iOS",
      "terminal_system_version": "26.1",
      "terminal_system_language": "zh_CN",
      "terminal_display": "iPhone18,3",
      "app_version": "2.6.80",
      "app_language": "zh_CN",
      "source": 1,
      "user_agent": "",
      "captcha_code": null
    },{
      headers: {
        'User-Agent': 'Dart/3.3 (dart:io)',
        'language_code': 'zh-CN',
        'app_version': '2.6.80',
        'country_code': 'cn',
        'content-type': 'application/json; charset=utf-8',
        'secret_id': 'bb45b726f50f467e9867a155ee8eb065',
        'x-b3-traceid': '6762cbc1cd3547c8bae750108d009019',
        'aiot-application-id': 'uSPzJhar1H',
        'is_app': true,
        'app-language': 'zh-CN',
        'app-version': '2.6.80',
        'ismainland': 1,
        'version_code': 2132
      },
    })

    if(resp.data.code === 0){
      this.token = resp.data.result.token;
    }
  }

  async loadDevices(): Promise<Device[]> {
    const resp = await axios.get('',{
      headers:{
        'app_version':'2.6.80',
        'language_code':'zh-CN',
        'did':'54b3a88e41824d29e5333719a2213181',
        'country_code':'cn',
        'uuid':'d2d3f220497b45c19e1f86f2c1e86333',
        'aiot-application-id':'uSPzJhar1H',
        'is_app':'true',
        'app-language':'zh-CN',
        'app-version':'2.6.80',
        'ismainland':'1',
        'auth-token':'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1dWlkIjoiZDJkM2YyMjA0OTdiNDVjMTllMWY4NmYyYzFlODYzMzMiLCJpZCI6NDAwNDQ2LCJ0b2tlbklkIjoiMDZhYzBlMzEtOTRmZi00MmEwLWIwYTQtZmJiN2UwNGE4MWVkIiwiaWF0IjoxNzcyNzE2MTU4LCJleHAiOjE3NzUxMzUzNTh9.UStByIjmMQ9_3A5VNErJbbKqHPeEjMVUHithNRbSu8E',
        'version_code':'2132',
      }
    })
    if(resp.data.code === 0){
      return resp.data.result.map((result:any)=>{
        return {machineId:result.machineId, snNumber:result.sn_number, model: result.robot_model, name:result.robot_name};
      });
    }
    return []
  }
}

export default NRAPI;
