import assert from 'assert/strict';
import Storage from '../storage/index.js';
import Tunnel from './tunnel.js';
import { Logger } from '../logger.js'; const logger = Logger("tunnel-service");

class TunnelService {
    constructor() {
        if (TunnelService.instance !== undefined) {
            return TunnelService.instance
        }
        this.activeTunnels = {};
        this.db = new Storage("tunnel");
        TunnelService.instance = this;
    }

    async get(tunnelId, accountId = undefined) {
        assert(tunnelId != undefined);
        let tunnel = this.activeTunnels[tunnelId];

        if (tunnel == undefined) {
            const tunnelProps = await this.db.get(tunnelId);
            if (!tunnelProps) {
                return undefined;
            }
            tunnel = new Tunnel(tunnelId, tunnelProps);
        }

        if (accountId != undefined && tunnel.props.account !== accountId) {
            return false;
        }

        this.activeTunnels[tunnelId] = tunnel;
        logger.isDebugEnabled() && logger.debug({
            operation: 'get_tunnel',
            tunnel: tunnel.props.id,
            account: tunnel.props.account,
        });
        return tunnel;
    }

    async create(tunnelId, accountId, tunnelProps = {}, opts = {}) {
        assert(tunnelId != undefined);
        assert(accountId != undefined);

        tunnelProps = {account: accountId, ...tunnelProps};
        const created = await this.db.set(tunnelId, tunnelProps, {NX: true});
        if (!created) {
            if (opts?.allowExists) {
                const tunnel = await this.get(tunnelId, accountId);
                if (tunnel) {
                    tunnel.setProps(tunnelProps);
                }
            } else {
                return false;
            }
        }

        const tunnel = new Tunnel(tunnelId, created);
        this.activeTunnels[tunnelId] = tunnel;

        logger.isDebugEnabled() && logger.debug({
            operation: 'create_tunnel',
            tunnel: tunnel.props.id,
            account: tunnel.props.account,
        });
        return tunnel;
    }

    async delete(tunnelId, accountId = undefined) {
        assert(tunnelId != undefined);
        const tunnel = await this.get(tunnelId, accountId);
        if (tunnel instanceof Tunnel == false) {
            return tunnel;
        }
        delete this.activeTunnels[tunnelId];
        await this.db.delete(tunnelId);
        await tunnel.delete();

        logger.isDebugEnabled() && logger.debug({
            operation: 'delete_tunnel',
            tunnel: tunnelId,
            account: accountId,
        });
        return true;
    }
}

export default TunnelService;