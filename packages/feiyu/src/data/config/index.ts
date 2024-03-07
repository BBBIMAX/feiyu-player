import { XSta } from 'xsta';

import { http } from '@/services/http';
import { ipfs, ipfsURL } from '@/services/ipfs';
import { storage } from '@/services/storage/storage';
import { jsonDecode, timestamp } from '@/utils/base';
import { deepClone } from '@/utils/clone';
import { isArray, isNotEmpty, isValidUrl } from '@/utils/is';

import defaultConfig from '../default';
import { subscribeStorage } from './storage';
import { FeiyuConfig, Subscribe } from './types';

export interface SubscribesStore {
  currentSubscribe: string;
  subscribes: Record<string, Subscribe>;
  allowSexy: boolean; // 不过滤伦理片
  allowMovieCommentary: boolean; // 不过滤电影解说
}

export const kSubscribesKey = 'kSubscribesKey';

export class APPConfig {
  static version = '1.0.0';
  static defaultKey = '默认订阅';
  static defaultConfig: Subscribe = {
    feiyu: APPConfig.version,
    key: APPConfig.defaultKey,
    lastUpdate: 1709781073831,
    config: defaultConfig as any,
  };

  private get _subscribes() {
    const origin = XSta.get<SubscribesStore>(kSubscribesKey)?.subscribes ?? {};
    return deepClone<Record<string, Subscribe>>(origin);
  }

  private get _currentSubscribe() {
    return (
      XSta.get<SubscribesStore>(kSubscribesKey)?.currentSubscribe ??
      APPConfig.defaultKey
    );
  }

  private _updateStore(data: Partial<SubscribesStore>) {
    const old = XSta.get<SubscribesStore>(kSubscribesKey) ?? {};
    XSta.set(kSubscribesKey, {
      ...old,
      ...data,
    });
  }

  get current(): FeiyuConfig {
    this.init(); // 被动初始化
    return this._subscribes[this._currentSubscribe]?.config ?? defaultConfig;
  }

  get allowSexy() {
    return storage.get('allowSexy');
  }
  get allowMovieCommentary() {
    return storage.get('allowMovieCommentary');
  }

  toggleAllowSexy() {
    const flag = !this.allowSexy;
    storage.set('allowSexy', flag);
    this._updateStore({
      allowSexy: flag,
    });
  }

  toggleAllowMovieCommentary() {
    const flag = !this.allowMovieCommentary;
    storage.set('allowMovieCommentary', flag);
    this._updateStore({
      allowMovieCommentary: flag,
    });
  }

  initialized = false;
  /**
   * 初始化订阅列表
   */
  async init() {
    const _subscribes = this._subscribes;
    if (this.initialized) {
      return; // 只从本地初始化一次
    }
    this.initialized = true;
    // 添加默认配置
    _subscribes[APPConfig.defaultKey] = APPConfig.defaultConfig;
    // 加载本地订阅配置
    const subscribes = await subscribeStorage.getAll();
    subscribes.forEach((e) => {
      _subscribes[e.key] = e;
    });
    // 从本地读取当前使用的配置记录
    let _currentSubscribe = APPConfig.defaultKey;
    const current = subscribeStorage.current();
    if (current) {
      _currentSubscribe = current;
    }
    // 初始化依赖
    this._updateStore({
      subscribes: _subscribes,
      currentSubscribe: _currentSubscribe,
      allowSexy: this.allowSexy,
      allowMovieCommentary: this.allowMovieCommentary,
    });
    // 刷新订阅
    this.refreshAll();
  }

  /**
   * 导出单个订阅
   */
  async exportSubscribe(key: string) {
    await this.init();
    if (!this._subscribes[key]) return false;
    const data = this._subscribes[key].config; // 只导出订阅 config
    const cid = await ipfs.writeJson(data, true);
    return cid ? ipfsURL(cid) : undefined;
  }

  /**
   * 批量导出订阅
   */
  async exportSubscribes() {
    await this.init();
    // 逆向导出订阅列表（导入时恢复原顺序）
    const subscribes = Object.values(this._subscribes).reverse();
    const cid = await ipfs.writeJson(subscribes, true);
    return cid ? ipfsURL(cid) : undefined;
  }

  /**
   * 批量导入订阅(返回导入成功个数)
   */
  async importSubscribes(url: string) {
    await this.init();
    let subscribes: Subscribe[] = await http.proxy.get(url, undefined, {
      cache: false,
    });
    let successItems = 0;
    if (!isArray(subscribes)) {
      return 0;
    }
    subscribes = subscribes.filter((e) => {
      return e.feiyu && e.config?.feiyu;
    });
    const _subscribes = this._subscribes;
    for (const subscribe of subscribes) {
      const link = subscribe.link;
      // 不能重名
      let newKey = subscribe.key ?? '未知订阅';
      while (_subscribes[newKey]) {
        newKey = newKey + '(重名)';
      }
      subscribe.key = newKey;
      // 不重复添加相同的订阅源
      const subscribeKeys = Object.values(_subscribes);
      const alreadySubscribed =
        isNotEmpty(link) && subscribeKeys.find((e) => e.link === link);
      if (alreadySubscribed) {
        continue; // 跳过已添加的订阅源
      }
      // 导入订阅
      const success = await subscribeStorage.set(newKey, subscribe);
      if (success) {
        _subscribes[newKey] = subscribe;
        successItems += 1;
      }
    }
    if (successItems > 0) {
      // 更新状态
      this._updateStore({
        subscribes: _subscribes,
      });
    }
    return successItems;
  }

  /**
   * 添加订阅
   */
  async addSubscribe(key: string, config: string) {
    await this.init();
    // 不能重名
    if (this._subscribes[key]) {
      return '订阅已存在，请重命名';
    }
    let _config: any;
    const link = isValidUrl(config) ? config : undefined;
    if (link) {
      // 不重复添加相同的订阅源
      const subscribes = Object.values(this._subscribes);
      const alreadySubscribed =
        isNotEmpty(link) && subscribes.find((e) => e.link === link);
      if (alreadySubscribed) {
        return `订阅已存在，请先删除：${alreadySubscribed.key}`;
      }
      // 获取配置数据
      _config = await http.proxy.get(link, undefined, { cache: false });
    } else {
      _config = jsonDecode(config);
    }
    if (_config?.feiyu) {
      // 更新订阅
      _config = {
        feiyu: APPConfig.version,
        key,
        link,
        lastUpdate: timestamp(),
        config: _config,
      };
      const success = await subscribeStorage.set(key, _config);
      if (success) {
        const _subscribes = this._subscribes;
        _subscribes[key] = _config;
        // 更新状态
        this._updateStore({
          subscribes: _subscribes,
        });
        return '添加成功';
      }
    }
    return '获取配置信息失败';
  }

  /**
   * 刷新单个订阅
   */
  async refreshSubscribe(key: string) {
    await this.init();
    const old = this._subscribes[key];
    if (old) {
      const link = old.link;
      if (!link) {
        // 本地配置，无需刷新
        return true;
      }
      let config = await http.proxy.get(link, undefined, { cache: false });
      if (config?.feiyu) {
        // 更新订阅
        config = {
          feiyu: APPConfig.version,
          key,
          link,
          lastUpdate: timestamp(),
          config,
        };
        const success = await subscribeStorage.set(key, config);
        if (success) {
          const _subscribes = this._subscribes;
          _subscribes[key] = config;
          // 更新状态
          this._updateStore({
            subscribes: _subscribes,
          });
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 编辑单个订阅（本地配置，暂不支持重命名）
   */
  async editSubscribe(subscribe: Subscribe) {
    await this.init();
    const key = subscribe.key;
    const old = this._subscribes[key];
    if (old) {
      const newData = {
        ...subscribe,
        lastUpdate: timestamp(),
      };
      const success = await subscribeStorage.set(key, newData);
      if (success) {
        const _subscribes = this._subscribes;
        _subscribes[key] = newData;
        // 更新状态
        this._updateStore({
          subscribes: _subscribes,
        });
        return true;
      }
    }
    return false;
  }

  /**
   * 刷新全部订阅
   */
  async refreshAll() {
    await this.init();
    await Promise.all(
      Object.keys(this._subscribes).map((key) => this.refreshSubscribe(key)),
    );
  }

  /**
   * 删除订阅
   */
  async remove(key: string) {
    await this.init();
    const success = await subscribeStorage.remove(key);
    if (success) {
      const _subscribes = this._subscribes;
      delete _subscribes[key];
      if (!_subscribes[APPConfig.defaultKey]) {
        _subscribes[APPConfig.defaultKey] = APPConfig.defaultConfig;
      }
      // 重置为默认值
      const flag = await this.setCurrent(APPConfig.defaultKey);
      if (flag) {
        // 更新状态
        this._updateStore({
          subscribes: _subscribes,
          currentSubscribe: APPConfig.defaultKey,
        });
        return true;
      }
    }
    return false;
  }

  /**
   * 清空订阅
   */
  async clear() {
    await this.init();
    const success = await subscribeStorage.clear();
    if (success) {
      // 重置为默认值
      const flag = await this.setCurrent(APPConfig.defaultKey);
      if (flag) {
        // 更新状态
        this._updateStore({
          subscribes: {
            [APPConfig.defaultKey]: APPConfig.defaultConfig,
          },
          currentSubscribe: APPConfig.defaultKey,
        });
        return true;
      }
    }
    return false;
  }

  /**
   * 选择当前订阅
   */
  async setCurrent(key: string) {
    await this.init();
    // 确保本地存在当前订阅
    if (this._subscribes[key]) {
      const success = await subscribeStorage.setCurrent(key);
      if (success) {
        // 更新状态
        this._updateStore({
          currentSubscribe: key,
        });
        return true;
      }
    }
    return false;
  }
}

export const configs = new APPConfig();