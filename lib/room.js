import _ from 'lodash';
import Canvas from 'canvas';
import config from 'config';
import Promise from 'bluebird';
import Redis from 'ioredis';
import fs from 'fs';

const APP_DIR = '/home/amec/code/multiplayer-paint';

const Image = Canvas.Image;

const redis = new Redis({ showFriendlyErrorStack: true });

const rooms = {};

const defaultLineWidth = config.canvas.default.lineWidth;
const defaultStrokeStyle = config.canvas.default.strokeStyle;
const defaultFillStyle = config.canvas.default.fillStyle;

export default class Room {
    constructor(room_id) {
        this.room_id = room_id;
        this.isLoaded = false;
    }

    load() {
        if (this.isLoaded) return Promise.resolve(this);

        return fs.readFileAsync(`${APP_DIR}/images/${this.room_id}.png`)
            .then((data) => {
                const img = new Image();
                img.source = data;
                const canvas = new Canvas(img.width, img.height);
                const g = canvas.getContext('2d');
                g.drawImage(img, 0, 0, img.width, img.height);

                this.g = g;
                this.canvas = canvas;
            })
            .catch(() => {
                const canvas = new Canvas(config.canvas.default.width, config.canvas.default.height);
                const g = canvas.getContext('2d');

                g.fillStyle = 'white';
                g.fillRect(0, 0, canvas.width, canvas.height);

                this.g = g;
                this.canvas = canvas;
            })
            .then(() => {
                this.isLoaded = true;
            })
            .return(this);
    }

    save() {
        return new Promise((resolve, reject) => {
            const out = fs.createWriteStream(`${APP_DIR}/images/${this.room_id}.png`);

            const imgStream = this.canvas.pngStream();

            imgStream.pipe(out);

            imgStream.on('end', resolve);
            imgStream.on('error', reject);
        });
    }

    resize({ width, height }) {
        
    }

    draw(actions) {
        const g = this.g;

        _.forEach(actions, (data) => {
            g.fillStyle = defaultFillStyle;
            g.strokeStyle = defaultStrokeStyle;
            g.lineWidth = defaultLineWidth;
            g.lineCap = 'round';

            switch (data.type) {
                case 'path':
                    g.beginPath();
                    g.save();

                    if (data.path[0].length === 3) {
                        if (data.path[0][2].ss) g.strokeStyle = data.path[0][2].ss;
                        if (data.path[0][2].fs) g.fillStyle = data.path[0][2].fs;
                        if (data.path[0][2].lw) g.lineWidth = data.path[0][2].lw;
                    }
                    
                    g.moveTo(data.path[0][0], data.path[0][1]);
                    g.restore();
                    
                    for (var i = 1; i < data.path.length; i++) {
                        g.save();
                        if (data.path[i].length === 3) {
                            if (data.path[0][2].ss) g.strokeStyle = data.path[0][2].ss;
                            if (data.path[0][2].fs) g.fillStyle = data.path[0][2].fs;
                            if (data.path[0][2].lw) g.lineWidth = data.path[0][2].lw;
                        }
                    
                        g.lineTo(data.path[i][0], data.path[i][1]);
                        
                        g.restore();
                    }
                    
                    g.stroke();
                    
                    break;
                
                case 'line':
                    g.beginPath();
                    g.save();
                    if (data.p.length === 5) {
                        if (data.p[4].ss) g.strokeStyle = data.p[4].ss;
                        if (data.p[4].fs) g.fillStyle = data.p[4].fs;
                        if (data.p[4].lw) g.lineWidth = data.p[4].lw;
                    }
                    g.moveTo(data.p[0], data.p[1]);
                    g.lineTo(data.p[2], data.p[3]);
                    g.stroke();
                    g.restore();
                    break;
            }
        });
    }

    getImage() {
        return Promise.try(() => {
            if (!this.isLoaded) {
                return this.load().then(() => this.getImage());
            }

            return this.canvas.toBuffer();
        });
    }
};

Room.get = (room_id) => {
    if (rooms[room_id]) return rooms[room_id];

    return new Room(room_id);
};
