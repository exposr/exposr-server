import TunnelState from "./tunnel-state.js";

class Tunnel {
    constructor(tunnelId, account) {
        this.id = tunnelId;
        this.account = account;
        this.transport = {
            token: undefined,
            ws: {
                enabled: false,
            },
            ssh: {
                enabled: false,
            },
        };
        this.ingress = {
            http: {
                enabled: false,
                url: undefined,
                urls: undefined,
                alt_names: [],
            },
            sni: {
                enabled: false,
                url: undefined,
                urls: undefined,
            },
        };
        this.upstream = {
            url: undefined,
        };
        this.created_at = undefined;
        this.updated_at = undefined;
        this._state = new TunnelState();
    }

    _deserialization_hook() {
        if (this.endpoints != undefined) {
            this.transport = this.endpoints;
            delete this.endpoints;
        }
    }

    state() {
        return this._state;
    }

    isOwner(accountId) {
        return accountId != undefined && accountId === this.account;

    }
}

export default Tunnel;