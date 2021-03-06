/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2019, Joyent, Inc.
 */

/* Test the Metric Agent app */
'use strict';

var test = require('tape').test;

var mod_bunyan = require('bunyan');
var mod_libuuid = require('libuuid');
var mod_restify = require('restify');

var lib_app = require('../lib/app');
var lib_common = require('../lib/common');
var lib_endpoints_metrics = require('../lib/endpoints/metrics');

var log = mod_bunyan.createLogger({
    level: 'fatal',
    name: 'cmon-agent',
    serializers: mod_restify.bunyan.serializers
});

var DEFAULT_CONFIG = {
    logLevel: 'fatal',
    port: 9990, /* 9990 chosen to not conflict with a running cmon-agent */
    ufdsAdminUuid: '5e90c035-59ee-4024-8d99-b78314d17638'
};

var DEFAULT_OPTS = {
    config: DEFAULT_CONFIG,
    log: log,
    ip: '127.0.0.1',
    sysinfo: {
        'Datacenter Name': 'cmon-agent-tests',
        UUID: '4f534c64-703e-11e8-8e83-f7ff376a4ae7'
    }
};

var DEFAULT_ENDPOINT = 'http://' + DEFAULT_OPTS.ip + ':' + DEFAULT_CONFIG.port;

/*
 * Creates the required header for a cmon-agent getMetrics request, setting the
 * isCoreZone value to the provided boolean.
 */
function createTestHeaders(isCoreZone) {
    var headerObj = {
        isCoreZone: isCoreZone
    };
    // Convert header object to base64 JSON string
    var jsonStr = JSON.stringify(headerObj);
    var headerStr = Buffer.from(jsonStr, 'utf8').toString('base64');
    var headers = {};
    headers[lib_endpoints_metrics.CMON_OPTS_HEADER] = headerStr;
    return headers;
}

test('create app succeeds', function _test(t) {
    var app;

    t.plan(10);

    t.doesNotThrow(function _createapp() {
        app = new lib_app(DEFAULT_OPTS);
    }, 'app created without error');
    t.ok(app, 'app');

    t.ok(app.config, 'app.config');
    t.deepEqual(app.config, DEFAULT_CONFIG, 'config matches');

    t.ok(app.ip, 'app.ip');
    t.deepEqual(app.ip, DEFAULT_OPTS.ip, 'ip matches');

    t.ok(app.log, 'app.log');
    t.deepEqual(app.log, log, 'log matches');

    t.ok(app.collector, 'app.collector');

    t.ok(app.server, 'app.server');

    app.close(function _onClose() {
        t.end();
    });
});

test('create app fails with bad or no opts', function _test(t) {
    var app;

    t.plan(12);

    t.throws(function _noOpts() {
        app = new lib_app();
    }, 'opts');
    t.throws(function _emptyOpts() {
        app = new lib_app({});
    }, 'opts.config');
    t.throws(function _noLogLevel() {
        app = new lib_app({ config: {} });
    }, 'opts.config.logLevel');
    t.throws(function _badLogLevel() {
        app = new lib_app({ config: { logLevel: 1 } });
    }, 'opts.config.logLevel');
    t.throws(function _noPort() {
        app = new lib_app({ config: { logLevel: 'DEBUG' } });
    }, 'opts.config.port');
    t.throws(function _badPort() {
        app = new lib_app({ config: { logLevel: 'DEBUG', port: 'abc' } });
    }, 'opts.config.port');
    t.throws(function _noUfdsAdminUuid() {
        app = new lib_app({ config: { logLevel: 'DEBUG', port: 8080 } });
    }, 'opts.config.ufdsAdminUuid');
    t.throws(function _noLog() {
        app = new lib_app({ config: DEFAULT_CONFIG });
    }, 'opts.log');
    t.throws(function _badLog() {
        app = new lib_app({ config: DEFAULT_CONFIG, log: 'log' });
    }, 'opts.log');
    t.throws(function _noIp() {
        app = new lib_app({ config: DEFAULT_CONFIG, log: log });
    }, 'opts.ip');
    t.throws(function _badIp() {
        app = new lib_app({ config: DEFAULT_CONFIG, log: log, ip: 12345 });
    }, 'opts.ip');

    t.notOk(app, 'app was not created');

    t.end();
});

test('start and close app succeeds', function _test(t) {
    var app;

    t.plan(5);

    t.doesNotThrow(function _createApp() {
        app = new lib_app(DEFAULT_OPTS);
    }, 'app created without error');
    t.ok(app, 'app');

    t.doesNotThrow(function _startAndCloseApp() {
        app.start(function _start() {
            t.pass('start function called cb');
            app.close(function _close() {
                t.pass('close function called cb');
                t.end();
            });
        });

    }, 'app start and close called without error');
});

test('http get metrics for zone succeeds', function _test(t) {
    t.plan(6);

    lib_common.fetchRunningZones(function _cb(ferr, zones) {
        t.notOk(ferr, 'ferr is not set');
        t.ok(zones, 'zones is set');
        t.ok(Array.isArray(zones), 'zones is an array');
        t.ok(zones && zones.length && (zones.length > 0), 'zones has elements');

        var metrics_route = '/v1/' + zones[0].uuid + '/metrics';
        var client = mod_restify.createStringClient({ url: DEFAULT_ENDPOINT });

        var app = new lib_app(DEFAULT_OPTS);
        app.start(function _start() {
            setTimeout(function _timeout() {
                client.get({
                    path: metrics_route,
                    headers: createTestHeaders(false)
                }, function _get(err, req, res, data) {
                    t.notOk(err, 'err is not set');
                    t.ok(data, 'data is set');

                    // We need to close our client, since the server waits for
                    // the clients before closing. Otherwise this test takes a
                    // long time.
                    client.close();

                    app.close(function _close() {
                        t.end();
                    });
                });
            }, 2000);
        });
    });
});

test('http get metrics for missing zone returns 404', function _test(t) {
    t.plan(4);

    var metrics_route = '/v1/' + mod_libuuid.create() + '/metrics';
    var client = mod_restify.createStringClient({ url: DEFAULT_ENDPOINT });

    var app = new lib_app(DEFAULT_OPTS);
    app.start(function _start() {
        setTimeout(function _timeout() {
            client.get({
                path: metrics_route,
                headers: createTestHeaders(false)
            }, function _get(err, req, res, data) {
                t.ok(err, 'err is set');
                t.equal(err.statusCode, 404, 'error is 404');
                t.ok(data);
                t.equal(data, 'container not found');

                // We need to close our client, since the server waits for
                // the clients before closing. Otherwise this test takes a long
                // time.
                client.close();

                app.close(function _close() {
                    t.end();
                });
            });
        }, 2000);
    });
});

test('http get global zone metrics succeeds', function _test(t) {
    t.plan(2);

    var metrics_route = '/v1/gz/metrics';
    var client = mod_restify.createStringClient({ url: DEFAULT_ENDPOINT });

    var app = new lib_app(DEFAULT_OPTS);
    app.start(function _start() {
        setTimeout(function _timeout() {
            client.get({
                path: metrics_route,
                headers: null /* Need to support client not setting headers */
            }, function _get(err, req, res, data) {
                t.notOk(err, 'err is not set');
                t.ok(data, 'data is set');

                client.close();

                app.close(function _close() {
                    t.end();
                });
            });
        }, 2000);
    });
});

/*
 * Note: refresh no longer actually does anything. This test is left here only
 * because refresh is in the v1 API and we want to ensure we're still matching
 * the API. It can be removed once we've decided this no longer needs to be in
 * the API.
 */
test('http refresh zones succeeds', function _test(t) {
    t.plan(2);

    var refresh_route = '/v1/refresh';
    var client = mod_restify.createStringClient({ url: DEFAULT_ENDPOINT });

    var app = new lib_app(DEFAULT_OPTS);
    app.start(function _start() {
        setTimeout(function _timeout() {
            client.post(refresh_route, function _get(err, req, res, data) {
                t.notOk(err, 'err is not set');
                t.notOk(data, 'data is set');

                // We need to close our client, since the server waits for
                // the clients before closing. Otherwise this test takes a long
                // time.
                client.close();

                app.close(function _close() {
                    t.end();
                });
            });
        }, 2000);
    });
});
