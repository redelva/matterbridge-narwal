/**
 * Narwal WebSocket client for communicating with zhinengtuodi.com servers
 *
 * @file narwalapi.ts
 * @license Apache-2.0
 */
import { AnsiLogger } from 'matterbridge/logger';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

// Device configuration
export interface Device {
  machineId: string;
  name: string;
  snNumber:string;
  model:string;
}

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

  async login():Promise<string> {
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
        // 'secret_id': 'bb45b726f50f467e9867a155ee8eb065',
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
      return resp.data.result.token
    }else{
      return ""
    }
  }

  async loadDevices(): Promise<Device[]> {
    const resp = await axios.get('https://cn-app.narwaltech.com/robot/',{
      headers:{
        'app_version':'2.6.80',
        'language_code':'zh-CN',
        'did':`${uuidv4()}`,
        'country_code':'cn',
        'uuid':`${uuidv4()}`,
        'aiot-application-id':'uSPzJhar1H',
        'is_app':'true',
        'app-language':'zh-CN',
        'app-version':'2.6.80',
        'ismainland':'1',
        'auth-token':`${this.token}`,
        'version_code':'2132',
      }
    })
    if(resp.data.code === 0){
      return resp.data.result.map((result:any)=>{
        return {machineId:result.machine_id, snNumber:result.sn_number, model: result.robot_model, name:result.robot_name};
      });
    }
    return []
  }
}

export default NRAPI;
