import assert from 'assert/strict';
import AltNameService from './altname-service.js';
import { ERROR_TUNNEL_INGRESS_BAD_ALT_NAMES } from '../utils/errors.js';
import { difference, symDifference } from '../utils/misc.js';
import HttpIngress from './http-ingress.js';
import SNIIngress from './sni-ingress.js';

class Ingress {
    constructor(opts) {
        if (Ingress.instance !== undefined) {
            return Ingress.instance;
        }
        Ingress.instance = this;
        assert(opts != undefined);
        this.opts = opts;
        this.ingress = {};

        const p = [];

        if (opts.http?.enabled == true) {
            p.push(new Promise((resolve) => {
                this.ingress.http = new HttpIngress({
                    ...opts.http,
                    callback: resolve,
                });
            }));
        }

        if (opts.sni?.enabled == true) {
            p.push(new Promise((resolve, reject) => {
                this.ingress.sni = new SNIIngress({
                    ...opts.sni,
                    callback: (e) => {
                        e ? reject(e) : resolve()
                    },
                });
            }));
        }

        this.altNameService = new AltNameService();

        Promise.all(p).then(() => {
            typeof opts.callback === 'function' && opts.callback();
        }).catch(e => {
            typeof opts.callback === 'function' && opts.callback(e);
        });
    }

    async destroy() {
        const promises = Object.keys(this.ingress)
            .map(k => this.ingress[k].destroy())
            .concat([this.altNameService.destroy()])
        return Promise.allSettled(promises);
    }

    async updateIngress(tunnel, prevTunnel) {
        const error = (code, values) => {
            const err = new Error(code);
            err.code = code;
            err.details = values;
            return err;
        };

        const update = async (ing) => {
            const obj = {
                ...tunnel.ingress[ing],
            };

            const prevAltNames = prevTunnel.ingress[ing]?.alt_names || [];
            const baseUrl = this.ingress[ing].getBaseUrl(tunnel.id);
            if (symDifference(obj?.alt_names || [], prevAltNames).length != 0) {
                const alt_names = await AltNameService.resolve(baseUrl.hostname, obj.alt_names);
                const diff = symDifference(alt_names, obj.alt_names);
                if (diff.length > 0) {
                    return error(ERROR_TUNNEL_INGRESS_BAD_ALT_NAMES, diff);
                }

                obj.alt_names = await this.altNameService.update(
                    ing,
                    tunnel.id,
                    difference(alt_names, prevAltNames),
                    difference(prevAltNames, alt_names)
                );
            }

            return {
                ...obj,
                ...this.ingress[ing].getIngress(tunnel, obj.alt_names),
            }
        };

        const ingress = {};
        for (const ing of Object.keys(this.ingress)) {
            const res = await update(ing);
            if (res instanceof Error) {
                return res;
            }
            ingress[ing] = res;
        }

        return ingress;
    }

    async deleteIngress(tunnel) {
        for (const ing of ['http', 'sni']) {
            await this.altNameService.update(
                ing,
                tunnel.id,
                [],
                tunnel.ingress[ing].alt_names,
            );
            tunnel.ingress[ing].alt_names = [];
        }
    }
}

export default Ingress;