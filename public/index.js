import $ from 'jquery';
import _ from 'lodash';
import jqueryMousewheel from 'jquery-mousewheel';
import Primus from './js/primus';

const room_id = window.room_id;

const socket = new Primus('http://paint-ws.tyscorp.net');

socket.send('join', room_id);

console.log(jqueryMousewheel);

$(() => {

const Mouse = {
    LEFT: false,
    MIDDLE: false,
    RIGHT: false,
    x: 0,
    y: 0,
    isOver: false,
    hasMoved: false
};

const offset = $("#overlay").offset();

const defaultLineWidth = 2;
const defaultStrokeStyle = "#000";
const defaultFillStyle = "rgba(0,0,0,1)"

let lineWidth = 2;

let lastX, lastY;

document.addEventListener('mousemove', (e) => {
    updateMouse(e);

    lastX = lastX != null ? lastX : Mouse.x;
    lastY = lastY != null ? lastY : Mouse.y;
    
    if (Mouse.LEFT || Mouse.RIGHT && Mouse.isOver) {
        sendLine(lastX, lastY, Mouse.x, Mouse.y);
    }
    
    lastX = Mouse.x;
    lastY = Mouse.y;

    updateUser();
});

function updateUser() {
    updateOverlay();

    socket.send('mouse', {
        x: Mouse.x,
        y: Mouse.y
    });
}

const users = {};

socket.on('user', (user) => {
    if (!users[user.id]) users[user.id] = {};

    _.merge(users[user.id], user);

    updateOverlay();
});

socket.on('draw', draw);

const canvas = document.getElementById('drawing');
const overlayCanvas = document.getElementById('overlay');
const imgPreload = document.getElementById('img-preload');

const g = canvas.getContext('2d');
const g2 = overlayCanvas.getContext('2d');

g.lineCap = 'round';

if (imgPreload.naturalWidth) {
    imageHasLoaded();
}
else {
    imgPreload.onload = imageHasLoaded;
}

function imageHasLoaded() {
    g.drawImage(imgPreload, 0, 0);
}

let overlayRepaintScheduled = false;

function updateOverlay() {
    if (overlayRepaintScheduled) return;

    overlayRepaintScheduled = true;

    requestAnimationFrame(() => {
        g2.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    
        _.forEach(users, (user) => {
            g2.beginPath();
            g2.arc(user.mouse.x, user.mouse.y, lineWidth / 2, 0, 2 * Math.PI, false);
            g2.stroke();
        });
        
        g2.beginPath();
        g2.arc(Mouse.x, Mouse.y, lineWidth / 2, 0, 2 * Math.PI, false);
        g2.stroke();

        overlayRepaintScheduled = false;
    });
}

function draw(actions) {
    _.forEach(actions, (data) => {
        console.log(data);
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

function updateMouse(e) {
    if (e.buttons) {
        Mouse.LEFT = ((e.buttons & 1) === 1);
        Mouse.RIGHT = ((e.buttons & 2) === 2);
    }

    var offset = $("#overlay").offset();
    Mouse.x = e.pageX - offset.left;
    Mouse.y = e.pageY - offset.top;
}

$('canvas').mousedown(function (e) {
    updateMouse(e);
    
    lastX = Mouse.x;
    lastY = Mouse.y;
});

$("canvas").mouseover(function (e) {
    updateMouse(e);
    
    if (Mouse.LEFT || Mouse.RIGHT) {
        sendLine(lastX, lastY, Mouse.x, Mouse.y);
    }

    Mouse.isOver = true;
});

$("canvas").mouseout(function (e) {
    lastX = Mouse.x;
    lastY = Mouse.y;

    updateMouse(e);
    
    if (Mouse.LEFT || Mouse.RIGHT) {
        sendLine(lastX, lastY, Mouse.x, Mouse.y);
    }

    Mouse.isOver = false;
});

$("body").mouseout(function (e) {
    updateMouse(e);

    Mouse.LEFT = false;
    Mouse.RIGHT = false;
});

$("body").mouseup(function (e) {
    if (Mouse.LEFT || Mouse.RIGHT && Mouse.isOver) {
        sendLine(lastX, lastY, lastX, lastY);
    }
    
    if (e.which == 1) {
        Mouse.LEFT = false;
    }
    else if (e.which == 3) {
        Mouse.RIGHT = false;
    }
});

$('canvas').bind('mousewheel', (e, delta) => {
    console.log(delta);
    lineWidth += delta > 0 ? 1 : -1;
    lineWidth = Math.min(lineWidth, 75);
    lineWidth = Math.max(lineWidth, 1);

    updateUser();
});

function sendLine (x1, y1, x2, y2, o) {
    var ss = defaultStrokeStyle;
        
    if (Mouse.LEFT) {
        ss = '#000';
    }
    else if (Mouse.RIGHT) {
        ss = "#FFF";
    }
    
    var opt = _.merge({ ss: ss, lw: lineWidth }, o);
    
    if (opt.lw % 2 === 1) {
        x1 += 0.5;
        y1 += 0.5;
        x2 += 0.5;
        y2 += 0.5;
    }
    
    var data = { type: 'line', p: [x1, y1, x2, y2, opt] };
    
    draw([data]);

    socket.send('draw', [data]);
}

});