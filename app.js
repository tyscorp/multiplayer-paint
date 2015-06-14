import _ from 'lodash';
import config from 'config';
import fs from 'fs';
import http from 'http';
import koa from 'koa';
import koaStatic from 'koa-static';
import koaViews from 'koa-views';
import Primus from 'primus';
import PrimusEmitter from 'primus-emitter';
import PrimusRooms from 'primus-rooms';
import Promise from 'bluebird';
import Room from './lib/room';
import Router from 'koa-router';

Promise.longStackTraces();

Promise.promisifyAll(fs);

const app = koa();
const router = new Router();

const renderApp = function *() {
    this.state.engine = 'lodash';

    const scripts = [
        { src: '/jspm_packages/system.js' },
        { src: '/config.js' }
    ];

    const room_id = this.params.room_id;

    if (room_id) {
        scripts.push({ data: `window.room_id = '${room_id}';` });
    }

    scripts.push({ data: "System.import('index');" });



    const content = yield Promise.try(() => {
        if (!room_id) return '';

        return Room.get(room_id).load().then((room) => {
            const width = room.canvas.width;
            const height = room.canvas.height;

            return `
                <img src="/api/${room_id}/image" id="img-preload" style="display: none;"/>
                <canvas id="drawing" width="${width}px" height="${height}px" oncontextmenu="return false;"></canvas>
                <canvas id="overlay" width="${width}px" height="${height}px" oncontextmenu="return false;"></canvas>
            `;
        });
    });

    yield this.render('./views/index', {
        content,
        scripts: _.map(scripts, (script) => {
            const src = script.src ? ` src="${script.src}"` : '';
            const data = script.data ? script.data : '';

            return `<script${src}>${data}</script>`;
        }).join('')
    });
};

const api = new Router({
    prefix: '/api'
});

app.use(koaViews({
    map: {
        html: 'lodash'
    }
}));

api.get('/:room_id/image', function *() {
    this.type = 'image/png';
    this.body = yield Room.get(this.params.room_id).getImage();
});

router.get('/', renderApp);
router.get('/c/:room_id', renderApp);

app.use(router.routes());
app.use(api.routes());

app.use(router.allowedMethods());

app.use(koaStatic(`${__dirname}/public`));

app.listen(config.port);

const server = http.createServer();
const primus = new Primus(server, { transformer: 'sockjs' });

primus.use('emitter', PrimusEmitter);
primus.use('rooms', PrimusRooms);

//primus.save('./public/js/primus.js');

primus.on('connection', (spark) => {
    spark.on('name', (name) => {
        spark.name = name;
    });

    spark.on('join', (room) => {
        if (spark.room_id) spark.leave(spark.room_id);
        spark.room_id = room;

        spark.join(spark.room_id);

        primus.room(spark.room_id).clients((clients) => {
            _.forEach(clients, (client) => {
                spark.send('user', {
                    id: client.id,
                    name: client.name,
                    mouse: client.mouse
                });
            });
        });
    });

    spark.on('mouse', (mouse) => {
        spark.mouse = {
            x: Number(mouse.x),
            y: Number(mouse.y)
        };

        //markUserDirty(spark);

        spark.room(spark.room_id).except(spark.id).send('user', {
            id: spark.id,
            mouse: spark.mouse
        });
    });

    spark.on('draw', (actions) => {
        spark.room(spark.room_id).except(spark.id).send('draw', actions);
        
        return Room.get(spark.room_id).load().then((room) => {
            room.draw(actions);
        });
    });
});


server.listen(config.socket.port);