# exposr

exposr is a self-hosted tunnel server that allows you to securely expose devices and services
behind NATs or firewalls to the Internet through public URLs.

exposr can for example be used for development and previews or for exposing services behind NAT/firewalls
to the Internet without port-forwarding and risk of exposing your IP address.

Why another "localhost reverse proxy"? exposr takes a slightly different approach than other servers
of the same type. exposr is designed to run as a container with horizontal elastic scaling properties,
and is well suited to run in container-orchestration systems like Kubernetes.

## Features

* Scales horizontally - more nodes can be added to increase capacity.
* No configuration files! - All configuration can be done as environment variables or command line options.
* Designed to run behind a load balancer (HTTP/TCP) (ex. nginx or HAProxy).
* Suitable to run in container-orchestration systems such as Kubernetes.
* Multiple transports - multiplexed websocket with custom client or SSH client forwarding.
* Multiple ingress methods - HTTP (with custom domain support) or SNI for TLS/TCP protocols.
* Custom client can forward to any host, does not require root privileges and only requires outbound HTTP(s) connections.
* Tunnel configuration through restful APIs.
* No passwords or e-mails - but still secure. An account number together with the tunnel identifier serves as credentials.

What it does *not* do
* Certificate provisioning.
* DNS provisioning.

This is on purpose as the server is designed to be stateless and to have elastic scaling
properties. Meaning these are more suitable to handle in other parts of the deployment stack, for
example at the load balancer.

## Demo

![](https://exposr.github.io/docs/img/demo/exposr-demo-20210629.gif)

# Architecture
exposr have three core concepts, transports, endpoints and ingress.

A tunnel is composed of a transport and a connection endpoint.
The endpoint is used by the client to establish a tunnel connection.
The transport of the tunnel is the underlying data stream of the tunnel, it supports
multiple independent streams over one connection.

The ingress is for traffic destined for the tunnel target, an ingress supports one
specific protocol and have a distinct way of identifying which tunnel the request
is bound for.

```
                          +-----------------------+
      +----------------+  |  +-----------------+  |
----->|    Ingress     +--|->|    Transport    +--|-----------+
      +----------------+  |  +-----------------+  |           v
                          |                       |   +----------------+     +--------------+
                          |        Tunnel         |   |    Client      +---->|    Target    |
                          |                       |   +-------+--------+     +--------------+
                          |  +-----------------+  |           |
                          |  |    Endpoint     |<-|-----------+
                          |  +-----------------+  |           |
                          +-----------------------+           |
                             +-----------------+              |
                             |      API        |<-------------+
                             +-----------------+
```

**Supported transport**

| Type       | Method                     | Endpoint   | Client support        |
| ---------- | -------------------------- |----------- | --------------------- |
| Websocket  | Custom multiplex websocket | HTTP       | [`exposr-cli`](https://github.com/exposr/exposr-cli) |
| SSH        | SSH TCP forwarding         | TCP        | Any SSH client        |

The Websocket transport endpoint can run behind a HTTP load balancer on the same port
as the API. The SSH transport endpoint requires a dedicated TCP port and requires
a TCP load balancer.

**Supported ingress methods**

| Type  | Method                   | Protocol support | Requirements                | Load balancer req. |
| ----- | ------------------------ | ---------------- | --------------------------- | ------------------ |
| HTTP  | Virtual host (subdomain) | HTTP             | Wildcard domain             | HTTP               |
| SNI   | SNI                      | TLS              | Wildcard certificate+domain | TCP                |

## Persistence
The default persistence mode is in-memory meaning all tunnel configurations are lost
when the server is restarted. Since tunnels (and accounts) are created by the client
on-the-fly this works good enough for small single-node setups.

Redis is supported for multi-node support or if long-term persistance is required.
## Horizontal scaling
exposr can be run in a clustered setup, ingress connections are re-routed to the node
that have the tunnel established. This allows load balancing in round-robin
fashion without need for sticky sessions.

Redis is required for clustered setup. No other configuration is needed, nodes
will auto-discover each other.

# Running exposr

## Runtime artifacts

Currently, only containers are available as a runtime artifacts.
Latest release is available with the `latest` tag, latest development is available with the `unstable` tag.

## Quick start
You can quickly try out exposr without installing anything.

Run the server, the server will listen on port 8080 and the API will be exposed at `http://host.docker.internal:8080`.
HTTP ingress sub-domains will be allocated from `http://localhost:8080`.

    docker run --rm -ti -p 8080:8080 exposr/exposr-server:latest --allow-registration --http-ingress-domain http://localhost:8080

Start the client with, this will create a tunnel called `example` and connect it to `http://example.com`.
The tunnel will be available at `http://example.localhost:8080`.

    docker run --rm -ti exposr/exposr:latest --server http://host.docker.internal:8080/ tunnel http://example.com example

Try the tunnel

    curl --resolve example.localhost:8080:127.0.0.1 http://example.localhost:8080

## Configuration

exposr needs to have at least one ingress and one transport method enabled. The default option enables
the HTTP ingress and the WS transport.

### Configuring HTTP ingress
The HTTP ingress can be enabled by passing the flag `--ingress http`.
It uses the same port as the API port, and fully supports HTTP(s) including upgrade requests (ex. websockets).

The HTTP ingress uses subdomains and virtual hosts to determine the tunnel id and requires a
wildcard DNS entry to be configured and pointed to your server or load balancer.

    *.example.com  IN A  10.0.0.1

The domain needs to be configured with `--ingress-http-domain`.

    exposr-server --ingress-http --ingress-http-domain http://example.com

Each tunnel will be allocated an subdomain, ex. `http://my-tunnel.example.com`.

If you have a proxy or load balancer in-front of exposr that terminates HTTPS, pass the domain with
the `https` protocol instead. (`--ingress-http-domain https://example.com).
#### BYOD (Bring Your Own Domain)
The HTTP ingress supports custom domain names to be assigned to a tunnel outside of the automatic one
allocated from the wildcard domain. Assigning a custom domain name to a tunnel will make exposr
recognize requests for the tunnel using this name.

To configure BYOD (altname) a CNAME for the domain must be created and pointing towards the FQDN
of the tunnel. For example, to use the name `example.net` for the tunnel `my-tunnel.example.com`
a CNAME should be configured for `example.net` pointing to `my-tunnel.example.com`.

    example.net  IN CNAME  my-tunnel.example.com

Finally the altname needs to be enabled in exposr, this can be done through the cli.

    exposr configure-tunnel my-tunnel ingress-http-altname example.net

The request will be rejected unless the CNAME is properly configured.

Note that if you have a load balancer or proxy in front of exposr that terminates HTTPS
you need have a certificate that covers the altname.
### Configuring SNI ingress

To enable the SNI (Server Name Indication) ingress pass the flag `--ingress sni`.
The SNI ingress requires a dedicated TCP port, by default it uses 4430. The port can be changed with `--ingress-sni-port`.

The SNI ingress works by utilizing the SNI extension of TLS to get the tunnel from the hostname. Similar to
the HTTP ingress it requires a wildcard DNS entry (`*.example.com`), but also a wildcard certificate covering
the same domain name. It's compatible with any protocol that can run over TLS and a client that supports SNI.

exposr will monitor the provided certificate and key for changes and re-load the certificate on-the fly.
#### Certificate

The certificate must contain one wildcard entry, either as the common name (`CN`) or in the SAN list.
If there are multiple wildcard entries present, the first one will be used.

For production use, a real certificate should be used. Let's encrypt offers free wildcard certificates.
For testing a self-signed can be generated with openssl.

    openssl req -x509 -newkey rsa:4096 -keyout private-key.pem -out certificate.pem -days 365 -nodes

#### Example

    exposr-server --ingress sni --ingress-sni-cert certificate.pem --ingress-sni-key private-key.pem

### Configuring SSH transport

To enable the SSH transport pass the flag `--transport ssh` to exposr.
By default it will use port 2200, it can be changed with `--transport-ssh-port`.
The base host name will by default use the API host, it can be overridden with `--transport-ssh-host`.

A new SSH host key will be generated at startup. If you run in a clustered setup it's recommended to provide
a static key so that clients always receive the same host key. The key can be specified either as a path or string
containing a SSH private key in PEM encoded OpenSSH format using `--transport-ssh-key`.

#### Example

Start the server with SSH transport enabled

    > docker run --rm -ti -p 8080:8080 -p 2200:2200 exposr/exposr-server:latest --allow-registration --http-ingress-domain http://localhost:8080 --transport ssh

Create and account and configure a tunnel

    > docker run --rm -ti exposr/exposr:latest -s http://host.docker.internal:8080/ create-account
    Created account MNF4 P6Y6 M2MR RVCT

    > docker run --rm -ti exposr/exposr:latest -s http://host.docker.internal:8080/ -a "MNF4 P6Y6 M2MR RVCT" create-tunnel my-tunnel
    Tunnel my-tunnel created

    > docker run --rm -ti exposr/exposr:latest -s http://host.docker.internal:8080/ -a "MNF4 P6Y6 M2MR RVCT" configure-tunnel my-tunnel transport-ssh true
    Setting transport-ssh to true

Fetch the SSH endpoint URL

    > docker run --rm -ti exposr/exposr:latest -s http://host.docker.internal:8080/ -a "MNF4 P6Y6 M2MR RVCT" tunnel-info my-tunnel
    [...]
      Transport endpoints
        SSH: ssh://my-tunnel:kXBnFV6Z1YoZPhoVLmxn9UO-Cp2qh7R19CGRrA_ylYfiiZ32N-CR9LWyHtaHxXn8UXGPNSt5xXUxf-5DlZOvLg@localhost:2200

Establish the tunnel with SSH as normal

    > ssh -o "StrictHostKeyChecking no" -o "UserKnownHostsFile /dev/null" -R example.com:80:example.com:80 ssh://my-tunnel:nfeflVuKGick0rD2C7Mqne6d-MDWPGCX6At7ygj0U8FTkgbLFi-XckuEUQ9-ipkJ0aRPkrxziKit4wWDisONXg@localhost:2200
    Warning: Permanently added '[localhost]:2200' (RSA) to the list of known hosts.
    exposr/v0.1.5
    Upstream target: http://example.com/
    HTTP ingress: http://my-tunnel.localhost:8080/

The upstream target can be configured with the `bind_address` part of the `-R` argument to ssh. If an upstream target
has already been configured the left-hand part of -R can be left out, example `-R 0:example.com:80`.

Note that the connection token is only valid for one connection, and must be re-fetched for each connection.

#### Permanent SSH key
Generate an SSH key with (only the private key is required)

    ssh-keygen -b 2048 -t rsa -f sshkey -q -N ""

The content of the file can be passed through environment variables

    EXPOSR_TRANSPORT_SSH_KEY=$(<sshkey) exposr-server [...]

You can also specify it as a path

    exposr-server [...] --transport-ssh-key /path/to/sshkey
### Using environment variables

Each option can be given as an environment variable instead of a command line option. The environment variable
is named the same as the command line option in upper case with `-` replaced with `_`, and prefixed with `EXPOSR_`.

For example the command line option `--ingress-http-domain example.com` would be specified as `EXPOSR_INGRESS_HTTP_DOMAIN=example.com`.

Multiple value options are specified as comma separated values.
For example `--transport ws --transport ssh` would be specifies `EXPOSR_TRANSPORT=ws,ssh`

## Production deployment

### Kubernetes

exposr can be deployed to Kubernetes with helm.

Add the repository

	helm repo add exposr https://exposr.github.io/helm-charts/
	helm repo update

Deploy with

    helm install my-exposr exposr/exposr
