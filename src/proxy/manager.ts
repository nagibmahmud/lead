import fs from 'fs';
import axios from 'axios';
import https from 'https';
import logger from '../utils/logger';
import { config } from '../config';

interface Proxy {
  host: string;
  port: number;
  protocol: 'http' | 'https';
  auth?: {
    username: string;
    password: string;
  };
}

export class ProxyManager {
  private proxies: Proxy[] = [];
  private currentIndex = 0;
  private useRotation: boolean;

  constructor() {
    this.useRotation = config.rotate_proxies;
    this.loadProxies();
  }

  /**
   * Load proxies from config or file
   */
  private loadProxies(): void {
    // From environment variables
    const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
    const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;

    if (httpProxy || httpsProxy) {
      if (httpsProxy) {
        this.proxies.push(this.parseProxyUrl(httpsProxy));
      } else if (httpProxy) {
        this.proxies.push(this.parseProxyUrl(httpProxy));
      }
    }

    // From proxy file
    if (config.proxy_file) {
      try {
        const fileContent = fs.readFileSync(config.proxy_file, 'utf-8');
        const lines = fileContent.split('\n').filter(line => line.trim());

        for (const line of lines) {
          const proxy = this.parseProxyLine(line.trim());
          if (proxy) {
            this.proxies.push(proxy);
          }
        }

        logger.info(`Loaded ${this.proxies.length} proxies from ${config.proxy_file}`);
      } catch (error) {
        logger.warn(`Could not load proxy file ${config.proxy_file}: ${error}`);
      }
    }

    if (this.proxies.length === 0) {
      logger.info('No proxies configured, using direct connection');
    }
  }

  /**
   * Parse proxy URL (http://user:pass@host:port)
   */
  private parseProxyUrl(url: string): Proxy {
    const parsed = new URL(url);
    const auth = parsed.username ? {
      username: decoded(parsed.username),
      password: decoded(parsed.password || ''),
    } : undefined;

    return {
      protocol: parsed.protocol === 'https:' ? 'https' : 'http',
      host: parsed.hostname,
      port: parseInt(parsed.port, 10),
      auth,
    };
  }

  /**
   * Parse proxy line (host:port or user:pass@host:port)
   */
  private parseProxyLine(line: string): Proxy | null {
    try {
      // Support format: host:port or user:pass@host:port
      if (line.includes('@')) {
        const [authPart, hostPart] = line.split('@');
        const [username, password] = authPart.split(':');
        const [host, portStr] = hostPart.split(':');
        return {
          protocol: 'http',
          host,
          port: parseInt(portStr, 10),
          auth: { username, password },
        };
      } else {
        const [host, portStr] = line.split(':');
        return {
          protocol: 'http',
          host,
          port: parseInt(portStr, 10),
        };
      }
    } catch (error) {
      logger.warn(`Failed to parse proxy line: ${line}`);
      return null;
    }
  }

  /**
   * Get current proxy (for rotation)
   */
  getCurrentProxy(): Proxy | undefined {
    if (this.proxies.length === 0) return undefined;
    return this.proxies[this.currentIndex];
  }

  /**
   * Get next proxy (round-robin)
   */
  nextProxy(): Proxy | undefined {
    if (!this.useRotation || this.proxies.length === 0) {
      return this.getCurrentProxy();
    }

    this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
    return this.getCurrentProxy();
  }

  /**
   * Get proxy config for axios
   */
  getAxiosProxyConfig(): any {
    const proxy = this.getCurrentProxy();

    if (!proxy) return undefined;

    const proxyUrl = proxy.auth
      ? `${proxy.protocol}://${proxy.auth.username}:${proxy.auth.password}@${proxy.host}:${proxy.port}`
      : `${proxy.protocol}://${proxy.host}:${proxy.port}`;

    return {
      host: proxy.host,
      port: proxy.port,
      protocol: proxy.protocol,
      ...(proxy.auth && {
        auth: {
          username: proxy.auth.username,
          password: proxy.auth.password,
        },
      }),
    };
  }

  /**
   * Get environment proxy string
   */
  getEnvProxy(): string | undefined {
    const proxy = this.getCurrentProxy();

    if (!proxy) return undefined;

    if (proxy.auth) {
      return `${proxy.protocol}://${proxy.auth.username}:${proxy.auth.password}@${proxy.host}:${proxy.port}`;
    }

    return `${proxy.protocol}://${proxy.host}:${proxy.port}`;
  }

  /**
   * Get all proxies count
   */
  getProxyCount(): number {
    return this.proxies.length;
  }

  /**
   * Reset to first proxy
   */
  reset(): void {
    this.currentIndex = 0;
  }

  /**
   * Test a specific proxy (or all)
   */
  async testProxy(proxy?: Proxy): Promise<boolean> {
    const testProxy = proxy || this.getCurrentProxy();

    if (!testProxy) return false;

    try {
      const testUrl = 'http://httpbin.org/ip';
      const proxyUrl = `${testProxy.protocol}://${testProxy.host}:${testProxy.port}`;

      const response = await axios.get(testUrl, {
        proxy: false, // Don't use global proxy
        httpsAgent: new https.Agent({ proxy: { host: testProxy.host, port: testProxy.port } }),
        timeout: 10000,
      });

      return response.status === 200;
    } catch (error) {
      logger.warn(`Proxy test failed: ${error.message}`);
      return false;
    }
  }
}

function decoded(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

// Singleton
const proxyManager = new ProxyManager();

export default proxyManager;

