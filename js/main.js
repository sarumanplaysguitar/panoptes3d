import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

console.log(`using three.js r${THREE.REVISION}`);

const PI = Math.PI;
const canvas = document.getElementById("canvas3d");
// const sceneManager = new SceneManager(canvas);

// Utils 🔨

function degreesToRadians(angle) {
    return angle * PI / 180;
}

function smoothstep(x, t1, t2) {
    let k = Math.max(0, Math.min(1, (x - t1)/(t2 - t1)));
    let s = k**2 * (3-2*k);

    return s;
}

// Variable to keep track of scene opacity and change it, if needed
let envOpacity = 1.0;

// ^ Does the debug stuff belong in here? probably

// Astronomical positions and data 🌙
// (get from API later)
// These are in degrees.
var sunAltitude = -10.3;
var previousSunAltitude = sunAltitude;
var diurnal = 0.;
var unitLatitude = 34.;
var cameraRotX = 0.;
var cameraRotY = 0.;
var cameraRotZ = 0.;

// stars data was imported from data/mag_5_stars.js in stars_arr


// Shaders 🔮

const stars_vshader = `
// This shader...
// 1) rotates vertices about z axis with latitude
// 2) rotates vertices about y axis with siderial time (diurnal motion)
// 3) sets star point size
// 4) calculates some info for the fragment shader's cutoffs

mat3 rotation_matrix_z(float angle_rad) {
    vec3 axis = vec3(0., 0., 1.);
    float s = sin(angle_rad);
    float c = cos(angle_rad);

    return mat3(
    c, s, 0,
    -s, c, 0,
    0, 0, 1
    );

}

mat3 rotation_matrix_y(float angle_rad) {
    vec3 axis = vec3(0., 1., 0.);
    float s = sin(angle_rad);
    float c = cos(angle_rad);

    return mat3(
    c, 0, s,
    0, 1, 0,
    -s, 0, c
    );
}

// need uniforms u_unitLatitude, u_siderial_angle in here 
// varying vec2 vUv;
varying vec2 v_uv;
uniform float u_unitLatitude;
uniform float u_scale;
uniform vec2 u_resolution;
attribute float size;
attribute float twinkle_offset;
uniform float u_time;
uniform float u_diurnal;
varying vec4 mvPosition;
varying vec3 pos;
varying vec4 glpos;
// varying vec4 origin;
varying vec4 glorigin;
uniform vec4 origin;
varying vec4 mv_origin;
const float PI = 3.14159265358979323846;
const float PI_2 = 1.57079632679489661923;
const float PI_4 = 0.78539816339744830962;
attribute vec3 star_color;
varying vec3 vColor;

// Undo Linearization function
vec3 undolinearize(vec3 color) {
    return pow(color, vec3(.4545454545));  // Convert from linear to sRGB
}

void main() {

    #ifdef USE_COLOR
    vColor = undolinearize(star_color);
    // vColor = vec3( 1.0, 0.0, 0.0 );
    #endif

    v_uv = uv - 0.5;

    // Correct for the offset between how unit's latitude=0 (horizon)
    // and star's default positions (NCP at zenith) were defined

    pos = rotation_matrix_y(u_diurnal) * position;
    pos = rotation_matrix_z(u_unitLatitude + PI_2) * pos;
    mvPosition = modelViewMatrix * vec4(pos, 1.0);
    float camera_dist = distance(mvPosition, origin);

    // shrink w/ distance
    float attenuation_factor = (u_resolution.y / (2. * - mvPosition.z)) * 0.01;

    // gl_PointSize = (size + 25. * pow(size, 3.) * sin(10. * u_time + twinkle_offset)) * attenuation_factor;
    // gl_PointSize = (size + 25. * pow(size, 3.) * sin(10. * u_time + twinkle_offset)) * attenuation_factor;
    gl_PointSize = 1. * size * attenuation_factor + sin(10. * u_time + twinkle_offset) * 0.15 * size;
    gl_Position = projectionMatrix * mvPosition;
    glpos = gl_Position;
    mv_origin = modelViewMatrix * vec4(0., 0., 0., 1.0);
    glorigin = projectionMatrix * origin;
}
`

const stars_fshader = `
varying vec3 vColor;
varying vec4 mvPosition;
varying vec3 pos;
varying vec4 glpos;
uniform vec4 origin;
varying vec4 mv_origin;
uniform vec2 u_resolution;
varying vec2 v_uv;


void main(void) {

    // float r = 0.799999999;
    // float d = length(v_uv);
    // float a = smoothstep(r, r-0.01, d);

    float aspect_ratio = u_resolution.x / u_resolution.y;

    // clip stars below horizon, and ones with "backs" facing camera
    // if ( mvPosition.z > mv_origin.z + (11.0 * (1. / length(mv_origin)) + clamp(aspect_ratio, 10., 20.) * 0.02)) {
    if ( mvPosition.z > mv_origin.z + (11.0 * (1. / length(mv_origin)) + clamp(aspect_ratio, 10., 20.) * 0.02) || pos.y < 0. + 0.2) {
    discard;
    }

    gl_FragColor = vec4(vColor, 1.);

}
`

const sky_vshader = `
varying vec3 final_mix;
uniform vec3 u_ground;
uniform vec3 u_horizon;
uniform vec3 u_low;
uniform vec3 u_mid;
uniform vec3 u_upper;
uniform vec3 u_white;

// Undo Linearization function
vec3 undolinearize(vec3 color) {
    return pow(color, vec3(.46));  // Convert from linear to sRGB
}

void main() {
    // Mix from the ground up.


    vec3 groundLinear = undolinearize(u_ground);
    vec3 horizonLinear = undolinearize(u_horizon);
    vec3 lowLinear = undolinearize(u_low);
    vec3 midLinear = undolinearize(u_mid);
    vec3 upperLinear = undolinearize(u_upper);

    vec3 mix1 = mix(groundLinear, horizonLinear, smoothstep(0.5, 0.55, uv.y));
    vec3 mix2 = mix(mix1, lowLinear, smoothstep(0.5, 0.65, uv.y));
    vec3 mix3 = mix(mix2, midLinear, smoothstep(0.5, 0.8, uv.y));
    vec3 mix4 = mix(mix3, upperLinear, smoothstep(0.7, 1.0, uv.y));


    final_mix = mix4;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const sky_fshader = `
varying vec3 final_mix;

void main(void) {
    gl_FragColor = vec4(final_mix, 1.0);
}
`

const ground_vshader = `
varying vec2 v_uv;

void main() {
    v_uv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const ground_fshader = `
uniform vec2 u_resolution;
uniform vec3 u_ground_glow;
varying vec2 v_uv;

// Make opacity falloff as function of distance
// Plane should be a solid color

void main(void) {
    vec2 coords = v_uv - 0.5;
    vec3 color = u_ground_glow;
    float d = length(coords);

    // float t = 0.4;
    // float falloff = clamp(d, 0.0, t);
    // gl_FragColor = vec4(vec3(color), (t - falloff) * 2.);

    float falloff = 1.0 - smoothstep(0.0, 0.4, d);

    gl_FragColor = vec4(color, falloff);
}
`


// FPS stats (by mrdoob) 📊

// var stats = new Stats();
// document.body.appendChild(stats.dom);
// requestAnimationFrame(function loop() { stats.update(); requestAnimationFrame(loop) });


// Camera settings 🎥

var env_scale_fac = 1;

const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector("canvas"), alpha: false, antialias: true, precision: "highp" });
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.NoToneMapping;

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 40 * 2);
console.log(`focal length: ${Math.round(camera.getFocalLength())}`);
camera.position.set(3, 0.6, 3);
var controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, 0);
controls.enablePan = false;
controls.minDistance = 1.5;
controls.maxDistance = 30;
controls.enableDamping = true;
controls.dampingFactor = 0.15;
controls.update();


// Scene setup 🖼

const scene = new THREE.Scene();
// scene.fog = new THREE.Fog(0x00003f, -20, 20);
scene.background = new THREE.Color(0x3A3A3A);
// scene.fog = new THREE.Fog(0xffffff, -7, 20);
scene.fog = new THREE.Fog(0xffffff, -7, 15);



// Lighting 💡

const light1 = new THREE.PointLight(0x696969, 1000, 0);
light1.position.set(10, 10, 10);
scene.add(light1);

const light2 = new THREE.PointLight(0x696969, 1000, 0);
light2.position.set(-10, 10, -10);
scene.add(light2);

// var directionalLight = new THREE.DirectionalLight(0xffffff, 2);
// scene.add(directionalLight);

// var ambient_light = new THREE.AmbientLight(0xbfa6ff, intensity = 0.5);
var ambient_light = new THREE.AmbientLight(0x696969);
ambient_light.intensity = 500;
scene.add(ambient_light);


// Sun altitude



// HDRI 🌇

// var pmremGenerator = new THREE.PMREMGenerator(renderer);
// new RGBELoader()
//     .setDataType(THREE.FloatType)
//     .setPath('assets/hdri/')
//     .load('placeholder_sunset.hdr', function (texture) {

//     var envMap = pmremGenerator.fromEquirectangular(texture).texture;
//     pmremGenerator.compileCubemapShader();

//     // scene.background = envMap;
//     scene.environment = envMap;

//     texture.dispose();
//     pmremGenerator.dispose();

//     });


// Materials 🎨

// Define from ground to zenith, to floor/ground highlight at last position
// TODO: reorganize these later from zenith -> ground, and either bundle light + floor data in
// with this, or separate all 3 of them
const sky_colors = {
    day: [
    0x94cbfe,
    0xe3fbff,
    0xc5efff,
    0xb5e7ff,
    0x95cbff,
    0xb5e7ff
    ],
    green: [
    0x80bfff,
    0xc5eef3,
    0x9cdef7,
    0x78c1fd,
    0x77a8ff,
    0x9addfc
    ],
    green_golden: [
    0x5f9df3,
    0xad9ed6,
    0xe4ffee,
    0x6ccaff,
    0x5f9df3,
    0x7abfff
    ],
    golden: [
    0x4c61d1,
    0xcfbee8,
    0xbad5fd,
    0x5c76da,
    0x5c76da,
    0x6f84e3
    ],
    twilight: [
    0x27247b,
    0x7060ae,
    0x5659a2,
    0x2c368a,
    0x2a277d,
    0x36419c
    ],
    twilight_night: [
    0x00003f,
    0x101063,
    0x0a0a4f,
    0x050539,
    0x050539,
    0x0b0b52
    ],
    night: [
    0x00003f,
    0x0a0a4f,
    0x070744,
    0x050539,
    0x050539,
    0x0b0b52
    ],
    deep_night: [
    0x00003f,
    0x0a0a4f,
    0x070744,
    0x050539,
    0x050539,
    0x0b0b52
    ]
  };
  
  const ambient_light_colors = {
    day: 0xa6a9ff,
    green: 0xa6a9ff,
    green_golden: 0xa6a9ff,
    golden: 0xd7a6ff,
    twilight: 0xbfa6ff,
    twilight_night: 0x6947bf,
    night: 0x6947bf,
    deep_night: 0x6947bf
  }
  
  const star_colors = {
    o: 0xc8c7ff, b: 0xbbdaff, a: 0xe7ecff, f: 0xedffff, g: 0xfafff1, k: 0xffffca, m: 0xffcdcd
  };

// const star_colors = [
//   // 0xff0000, 0xc8c7ff, 0xbbdaff, 0xe7ecff, 0xedffff, 0xfafff1, 0xffffca, 0xffcdcd
// ];

const star_color_index = [-0.33, -0.3, -0.02, 0.3, 0.58, 0.81, 1.4];

const sun_thresholds = [90, 50, -5, -10, -13, -16, -18, -90];

function blend_sky_colors(sunAltitude, sun_thresholds, sky_colors) {
    // Returns array of linearly interpolated sky colors (one for each degree breakpoint in sun_thresholds)
    // based on sun's altitude, and blended from a few key, preset sky colors/edge cases (hex codes in sky_colors)
    // Also blends fog and ambient light colors, and sets fog strength to increase after sunset

    var sky_color_lerp_array = [];
    var num_thresholds = sun_thresholds.length;
    // console.log(sky_colors);
    var num_colors = sky_colors['day'].length;
    var sky_colors_keys = Object.keys(sky_colors);

    // Determine what "time of day" it is by seeing which of the 2 thresholds sunAltitude is within
    for (let i = 0; i < num_thresholds; i++) {
    if (sunAltitude >= sun_thresholds[i]) {

        // ambient_light.color.set(ambient_light_colors[sky_colors_keys[i]]);
        // console.log(ambient_light_colors[i]);

        if (sunAltitude == sun_thresholds[i]) {
        // It's equal to an edge case, so nothing to interpolate - just return pre-made sky colors.
        // sky_color_lerp_array = sky_colors[sky_colors_keys[i]];
        for (let j = 0; j < num_colors; j++) {
            var key_color = new THREE.Color(sky_colors[sky_colors_keys[i]][j]);
            sky_color_lerp_array.push(key_color);

            // Update fog color if color calculated was ground (first entry in color table)
            if (j == 0) {
                scene.fog.color = key_color;
                scene.fog.near = -10 + -22 * smoothstep(sunAltitude, 5, -19);
            }
            if (j == 0) ambient_light.color.set(key_color);
        }
        } else {
        // Need to interpolate between 2 thresholds, in order of day -> night (or, higher sun altitude -> lower)
        var upper_threshold = sun_thresholds[i - 1];
        var lower_threshold = sun_thresholds[i];

        var percent = Math.round(((upper_threshold - sunAltitude) / (upper_threshold - lower_threshold) + 0.00001) * 100) / 100;
        // console.log(percent, '%', sun_thresholds[i - 1], 'to', sun_thresholds[i], 'for i: ', i);



        // Create LERP blends of all colors between the two edge case skies
        for (let j = 0; j < num_colors; j++) {
            var start_color = new THREE.Color(sky_colors[sky_colors_keys[i - 1]][j]);
            // Even if this works it's bad and i need to fix it
            var end_color = new THREE.Color(sky_colors[sky_colors_keys[i]][j]);
            // console.log("yo", sky_colors[sky_colors_keys[i]][j]);

            var blend_color = start_color.lerpHSL(end_color, percent);

            sky_color_lerp_array.push(blend_color)

            // Update fog color if color calculated was ground (first entry in color table)
            if (j == 0) {
                scene.fog.color = blend_color;
                scene.fog.near = -10 + -22 * smoothstep(sunAltitude, 5, -19);
            }
            if (j == 0) ambient_light.color.set(blend_color);
        }
        }
    }
    // if (sky_color_lerp_array.length != 0) console.log(sky_color_lerp_array);
    if (sky_color_lerp_array.length != 0) break;
    }
    return sky_color_lerp_array;
}

// Assign initial sky colors
var blended_sky_colors = blend_sky_colors(sunAltitude, sun_thresholds, sky_colors);
console.log(blended_sky_colors)
// var blended_sky_colors = blend_sky_colors(sunAltitude, sun_thresholds, sky_colors).map(color => {
//     return new THREE.Color(color).convertSRGBToLinear();  // Convert from sRGB to Linear

function update_colors(sky_uniforms, ground_uniforms, new_sky_colors) {
    // Update any colors dependent on sun latitude here, ie. sky and ground
    // also fog...?
    sky_uniforms.u_ground = { value: new_sky_colors[0] },
    sky_uniforms.u_horizon = { value: new_sky_colors[1] },
    sky_uniforms.u_low = { value: new_sky_colors[2] },
    sky_uniforms.u_mid = { value: new_sky_colors[3] },
    sky_uniforms.u_upper = { value: new_sky_colors[4] },
    ground_uniforms.u_ground_glow = { value: new_sky_colors[5] }
    // console.log(new_sky_colors);
}

const sky_uniforms = {
    u_ground: { value: blended_sky_colors[0] },
    u_horizon: { value: blended_sky_colors[1] },
    u_low: { value: blended_sky_colors[2] },
    u_mid: { value: blended_sky_colors[3] },
    u_upper: { value: blended_sky_colors[4] },
    u_white: { value: new THREE.Color(0xffffff) },
    u_time: { value: 0.0 },
    u_resolution: { value: { x: 0, y: 0 } }
};

const ground_uniforms = {
    u_ground_glow: { value: blended_sky_colors[5] },
    u_resolution: { value: { x: 0, y: 0 } }
};

var object_loader = new THREE.ObjectLoader();

const horizon_material = new THREE.MeshBasicMaterial({
    // alphaMap: object_loader.load('assets/textures/horizon_mountains.png'),
    side: THREE.BackSide,
    fog: false
});

const sky_material = new THREE.ShaderMaterial({
    uniforms: sky_uniforms,
    vertexShader: sky_vshader,
    fragmentShader: sky_fshader,
    side: THREE.BackSide,
    fog: false
});

const ground_material = new THREE.ShaderMaterial({
    uniforms: ground_uniforms,
    vertexShader: ground_vshader,
    fragmentShader: ground_fshader,
    fog: false,
    transparent: true
});

console.log(ground_uniforms);

const stars_uniforms = {
    u_time: { value: 0.0 },
    u_diurnal: { value: 0.0 },
    u_resolution: { value: { x: window.innerWidth, y: window.innerHeight } },
    u_scale: { value: window.innerHeight / 2. },
    u_unitLatitude: { value: -1. * degreesToRadians(unitLatitude) }
}

// console.log(window.innerHeight);
// console.log(renderer.domElement.clientHeight);

const stars_material = new THREE.ShaderMaterial({
    defines: {
    USE_COLOR: true,
    },
    uniforms: stars_uniforms,
    vertexShader: stars_vshader,
    fragmentShader: stars_fshader,
    transparent: true
    // vertexColors: true
});


// Objects 🔭

// Azimuthal grid
var altaz_grid_primary_mat = new THREE.LineBasicMaterial({
    // color: sky_uniforms.u_horizon,
    color: 0xffffff,
    fog: false
});



var altaz_grid_secondary_mat = new THREE.LineBasicMaterial({
    // color: sky_uniforms.u_mid
})

// Equatorial grid

// On-sky camera FOV?
var line_mat = new THREE.LineBasicMaterial({
    color: 0x5279c8,
    // transparent: true,
    // opacity: 0.5,
    fog: false
});

// console.log(sky_uniforms.u_horizon)

var line_points = [];
// var r = 3.6;
var r = 0;
// var x = 3.6 * Math.cos(degreesToRadians(15 / 2));
// var y = 3.6 * Math.sin(degreesToRadians(15 / 2))
var half_theta_x = 15 / 2;
var half_theta_y = 10 / 2;
var x = [0.4 + 2 * r - 0.5, 0.5 + 2 * r - 0.5, 0.5 + 2 * r - 0.5, 0.4 + 2 * r - 0.5];
var y = [0.5 + 0.5, 0.25 + 0.5, -0.25 - 0.5, -0.5 - 0.5];
var z = [-1.5, -0.5, 0.5, 1.5];

var horiz_x = [];
var horiz_y = [];
var vert_z = [];

var vert_x = [];
var vert_y = [];
var vert_z = [];

var n = 4;
var m = 4;

for (var i = 0; i < n; i++) {
    line_points.push(new THREE.Vector3(
    // r * Math.sin(degreesToRadians(half_theta_x / (i - (n / 2)))),
    x[i] * 0.5,
    y[0] * 0.5,
    // r * Math.sin(degreesToRadians(half_theta_y)),
    z[i] * 0.5
    // r * Math.cos(degreesToRadians(half_theta_x / (i - (n / 2))))
    ));
}

for (var i = 0; i < 4; i++) {
    line_points.push(new THREE.Vector3(
    x[0] * 0.5,
    y[i] * 0.5,
    -z[0] * 0.5
    ));
}


for (var i = 0; i < n; i++) {
    line_points.push(new THREE.Vector3(
    x[i] * 0.5,
    -y[0] * 0.5,
    -z[i] * 0.5
    ));
}

for (var i = 0; i < n; i++) {
    line_points.push(new THREE.Vector3(
    x[0] * 0.5,
    y[i] * 0.5,
    z[0] * 0.5
    ));
}

var line_geometry = new THREE.BufferGeometry().setFromPoints(line_points);

var line = new THREE.Line(line_geometry, line_mat);
// scene.add(line);
// line.rotateZ(degreesToRadians(180-unitLatitude))
// line.translateX(3.6)


function get_star_data(stars_arr, median_magnitude, base_size) {

    // Each star has data in this order: [x, y, z, vmag, color, con]
    // Get star data and determine the following for each star in this array:
    var star_data;
    var position;
    var mag;
    var size;
    var bv_index;
    var color = new THREE.Color();
    var twinkle_offset;

    // Store that data in the respective arrays, to be returned:
    var star_positions = [];
    // var star_colors = new Float32Array(stars_arr.length * 3);
    var star_colors = [];
    var star_sizes = [];
    var twinkle_offsets = [];

    for (let i = 0; i < stars_arr.length; i++) {
    star_data = stars_arr[i];
    position = star_data.slice(0, 3);

    // Set vertex position: x, y, z
    star_positions.push(position[0] * env_scale_fac);
    star_positions.push(position[1] * env_scale_fac);
    star_positions.push(position[2] * env_scale_fac);

    // Calculate size
    mag = star_data[3];
    size = -1 * mag + 6;
    // console.log(size);
    // size = base_size * (2.5);
    // size = (8 - mag);
    star_sizes.push(size);

    // Determine and set color
    bv_index = star_data[4];
    if (bv_index <= star_color_index[0]) {
        color.setHex(0xc3c2ff);
    } else if (bv_index <= star_color_index[1]) {
        color.setHex(0xb5d6ff);
    } else if (bv_index <= star_color_index[2]) {
        color.setHex(0xe5ebff);
    } else if (bv_index <= star_color_index[3]) {
        color.setHex(0xebffff);
    } else if (bv_index <= star_color_index[4]) {
        color.setHex(0xf9fff0);
    } else if (bv_index <= star_color_index[5]) {
        color.setHex(0xffffc5);
    } else {
        color.setHex(0xffc9c9);
    }

    // star_colors.push([color.r, color.g, color.b]);
    star_colors.push(color.r, color.g, color.b);
    // color.toArray(star_colors, i * 3);
    // if (i == 5) console.log(star_colors);
    // if (i == 1) console.log(star_colors[0]);

    // Unique, random twinkle phase shift
    twinkle_offset = Math.random() * 10
    twinkle_offsets.push(twinkle_offset)
    }

    return { positions: star_positions, colors: star_colors, sizes: star_sizes, twinkle_offsets: twinkle_offsets };

}

// Brightest stars 🌟
var brightest_stars_geometry = new THREE.BufferGeometry();
var brightest_stars_data = get_star_data(brightest_stars_arr, 0., 3. * 0.001);

// console.log(brightest_stars_data.positions.length);
// console.log(brightest_stars_data.colors.length);

brightest_stars_geometry.setAttribute('position', new THREE.Float32BufferAttribute(brightest_stars_data.positions, 3));
// brightest_stars_geometry.colors = brightest_stars_data.colors
brightest_stars_geometry.setAttribute('star_color', new THREE.Float32BufferAttribute(brightest_stars_data.colors, 3));
// console.log(brightest_stars_data.colors);
brightest_stars_geometry.setAttribute('size', new THREE.Float32BufferAttribute(brightest_stars_data.sizes, 1).setUsage(THREE.DynamicDrawUsage));
brightest_stars_geometry.setAttribute('twinkle_offset', new THREE.Float32BufferAttribute(brightest_stars_data.twinkle_offsets, 1).setUsage(THREE.DynamicDrawUsage));

// var stars = new THREE.Points(stars_geometry, new THREE.PointsMaterial({ color: 0xffffff, size: 0.02, fog: false }));
var brightest_stars = new THREE.Points(brightest_stars_geometry, stars_material);
scene.add(brightest_stars);


// Bright stars 🌟
var bright_stars_geometry = new THREE.BufferGeometry();
var bright_stars_data = get_star_data(bright_stars_arr, 1.5, 2.75 * 0.025);

bright_stars_geometry.setAttribute('position', new THREE.Float32BufferAttribute(bright_stars_data.positions, 3));
bright_stars_geometry.setAttribute('star_color', new THREE.Float32BufferAttribute(bright_stars_data.colors, 3));
// stars_geometry.setAttribute('color', )
bright_stars_geometry.setAttribute('size', new THREE.Float32BufferAttribute(bright_stars_data.sizes, 1).setUsage(THREE.DynamicDrawUsage));
bright_stars_geometry.setAttribute('twinkle_offset', new THREE.Float32BufferAttribute(bright_stars_data.twinkle_offsets, 1).setUsage(THREE.DynamicDrawUsage));

// var stars = new THREE.Points(stars_geometry, new THREE.PointsMaterial({ color: 0xffffff, size: 0.02, fog: false }));
var bright_stars = new THREE.Points(bright_stars_geometry, stars_material);
scene.add(bright_stars);


// Average stars ⭐️
var average_stars_geometry = new THREE.BufferGeometry();
var average_stars_data = get_star_data(average_stars_arr, 2.5, 1.2 * 0.025);

average_stars_geometry.setAttribute('position', new THREE.Float32BufferAttribute(average_stars_data.positions, 3));
average_stars_geometry.setAttribute('star_color', new THREE.Float32BufferAttribute(average_stars_data.colors, 3));
// stars_geometry.setAttribute('color', )
average_stars_geometry.setAttribute('size', new THREE.Float32BufferAttribute(average_stars_data.sizes, 1).setUsage(THREE.DynamicDrawUsage));
average_stars_geometry.setAttribute('twinkle_offset', new THREE.Float32BufferAttribute(average_stars_data.twinkle_offsets, 1).setUsage(THREE.DynamicDrawUsage));

// var stars = new THREE.Points(stars_geometry, new THREE.PointsMaterial({ color: 0xffffff, size: 0.02, fog: false }));
var average_stars = new THREE.Points(average_stars_geometry, stars_material);
scene.add(average_stars);


// Faint stars ✨
var faint_stars_geometry = new THREE.BufferGeometry();
var faint_stars_data = get_star_data(faint_stars_arr, 4.5, 1. * 0.025);

faint_stars_geometry.setAttribute('position', new THREE.Float32BufferAttribute(faint_stars_data.positions, 3));
faint_stars_geometry.setAttribute('star_color', new THREE.Float32BufferAttribute(faint_stars_data.colors, 3));
// stars_geometry.setAttribute('color', )
faint_stars_geometry.setAttribute('size', new THREE.Float32BufferAttribute(faint_stars_data.sizes, 1).setUsage(THREE.DynamicDrawUsage));
faint_stars_geometry.setAttribute('twinkle_offset', new THREE.Float32BufferAttribute(faint_stars_data.twinkle_offsets, 1).setUsage(THREE.DynamicDrawUsage));

// var stars = new THREE.Points(stars_geometry, new THREE.PointsMaterial({ color: 0xffffff, size: 0.02, fog: false }));
var faint_stars = new THREE.Points(faint_stars_geometry, stars_material);
scene.add(faint_stars);


// // Faintest stars ✨
// var faintest_stars_geometry = new THREE.BufferGeometry();
// var faintest_stars_data = get_star_data(faintest_stars_arr, 0.4);

// faintest_stars_geometry.setAttribute('position', new THREE.Float32BufferAttribute(faintest_stars_data.positions, 3));
// // stars_geometry.setAttribute('color', )
// faintest_stars_geometry.setAttribute('size', new THREE.Float32BufferAttribute(faintest_stars_data.sizes, 1).setUsage(THREE.DynamicDrawUsage));
// faintest_stars_geometry.setAttribute('twinkle_offset', new THREE.Float32BufferAttribute(faintest_stars_data.twinkle_offsets, 1).setUsage(THREE.DynamicDrawUsage));

// // var stars = new THREE.Points(stars_geometry, new THREE.PointsMaterial({ color: 0xffffff, size: 0.02, fog: false }));
// var faintest_stars = new THREE.Points(faintest_stars_geometry, stars_material);
// scene.add(faintest_stars);


var ground_geometry = new THREE.PlaneGeometry(7.4 * (env_scale_fac * 0.4), 7.4 * (env_scale_fac * 0.4), 1, 1);
var ground_test = new THREE.Mesh(ground_geometry, ground_material);
ground_test.position.y = -0.01;
ground_test.rotateX(-PI / 2);
// scene.add(ground_test);
// ground_test.visible = false;

var sky_geometry = new THREE.SphereGeometry(3.7 * env_scale_fac, 50, 26);
var sky_test = new THREE.Mesh(sky_geometry, sky_material);
scene.add(sky_test);

// var horizon_geometry = new THREE.CylinderBufferGeometry(3 * env_scale_fac, 3 * env_scale_fac, 1, 50);
// var horizon_test = new THREE.Mesh(horizon_geometry, horizon_material);
// scene.add(horizon_test);

var axesHelper = new THREE.AxesHelper(5);
// scene.add(axesHelper);

var loader = new GLTFLoader();

var unit, mesh, clouds, sky, control_box, environment;

let groundObjects = new Array();

loader.load('assets/unit.glb', onLoadUnit);
loader.load('assets/control_box.glb', onLoadControlBox);
// loader.load('assets/environments/snow/snow_smooth.glb', onLoadEnvironment);
// loader.load('assets/placeholder_sky.glb', onLoadSky);
// loader.load('assets/placeholder_ground.glb', onLoad);
loader.load('assets/placeholder_clouds.glb', onLoadClouds);
// loader.load('assets/lucky_cat.glb', onLoad);

function onLoadUnit(gltf) {
    // console.log(gltf);
    unit = gltf.scene;
    // unit.position.x = -2 / Math.sqrt(2);
    // unit.position.z = -2 / Math.sqrt(2);

    scene.add(unit);
    var dec_axis = unit.getObjectByName("empty_dec", true); // aka head unit
    // line.x -= dec_axis.getWorldPosition.x;
    // console.log(line.position.x)
    // line.position.z += 0.25;
    // line.position.y -= 5;
    // console.log(line.position.x)
    // console.log(dec_axis.getWorldPosition)
    // line.y -= dec_axis.getWorldPosition.y;
    // line.z -= dec_axis.getWorldPosition.z;
    // line.updateMatrixWorld();
    // dec_axis.updateMatrixWorld();
    // line.parent = dec_axis;
    // line.scale.set(6.2, 6.2, 6.2);
}

function onLoadControlBox(gltf) {
    let num_components = gltf.scene.children.length;
    control_box = gltf.scene;
    control_box.position.x = -2 / Math.sqrt(2);
    control_box.position.z = -1 / Math.sqrt(2);
    control_box.rotateY(degreesToRadians(145.));

    for (let i=0; i < num_components; i++) {
        let component = gltf.scene.children[i];

        component.material.transparent = true;
        component.material.opacity = 1.;
    }
    // um maybe traverse model instead ^ but this works anyhow

    // scene.add(control_box);
}

function onLoadEnvironment(gltf) {
    let num_components = gltf.scene.children.length;
    environment = gltf.scene;
    // environment.position.x = -2 / Math.sqrt(2);
    // environment.position.z = -1 / Math.sqrt(2);
    // environment.rotateY(degreesToRadians(145.));

    for (let i=0; i < num_components; i++) {
        let component = gltf.scene.children[i];

        component.material.transparent = true;
        component.material.opacity = 1.;
    }
    // um maybe traverse model instead ^ but this works anyhow

    scene.add(environment);
}

function onLoadSky(gltf) {
    // console.log(gltf);
    sky = gltf.scene;

    scene.add(sky);

    var cube_bbox = new THREE.Box3();
    cube_bbox.setFromObject(sky);
    // console.log(cube_bbox.max.y - cube_bbox.min.y);
}

function onLoad(gltf) {
    // console.log(gltf);
    mesh = gltf.scene;
    // sky.lights = false;

    scene.add(mesh);
}

function onLoadClouds(gltf) {
    // console.log(gltf);
    clouds = gltf.scene;
    clouds.scale.set(env_scale_fac, env_scale_fac, env_scale_fac);
    // sky.lights = false;

    scene.add(clouds);
}

function setStarVisibility() {
    if (sunAltitude < -8) {
        brightest_stars.visible = true;
    } else {
        brightest_stars.visible = false;
    }

    if (sunAltitude < -10) {
        bright_stars.visible = true;
    } else {
        bright_stars.visible = false;
    }

    if (sunAltitude < -13) {
        average_stars.visible = true;
    } else {
        average_stars.visible = false;
    }

    if (sunAltitude < -18) {
        faint_stars.visible = true;
    } else {
        faint_stars.visible = false;
    }
}

setStarVisibility();


// Demo input GUI 🕹

var guiControls = new function () {
    this.RA = -40.;
    this.Dec = 88.;
    this.Latitude = unitLatitude;
    this.Sun = sunAltitude;
    this.Diurnal = 0.;
    this.Cloudy = false;
    this.Axes = true;
    this.CameraRotX = 0.;
    this.CameraRotY = 0.;
    this.CameraRotZ = 0.;
}

var gui = new dat.GUI();
gui.closed = true;
gui.add(guiControls, 'RA', -180, 180);
gui.add(guiControls, 'Dec', -180, 180);
gui.add(guiControls, 'Latitude', 0, 90);
gui.add(guiControls, 'Sun', -90, 90);
gui.add(guiControls, 'Diurnal', 0, 360);
gui.add(guiControls, 'Cloudy');
gui.add(guiControls, 'Axes');
gui.add(guiControls, 'CameraRotX', 0, 360);
gui.add(guiControls, 'CameraRotY', 0, 360);
gui.add(guiControls, 'CameraRotZ', 0, 360);





// Controls ⌨

function bindEventListeners() {
    window.onresize = resizeCanvas;
    resizeCanvas();
}

// Helper function: fade
function updateOpacity(obj, newOpacity) {

    // obj.material.transparent = true;

    if (newOpacity == 0.) {
        obj.visible = false;
    } else {
        obj.visible = true;
        obj.traverse(n => { if ( n.isMesh ) {
                n.material.opacity = newOpacity;
            }
        })
    // obj.material.opacity = newOpacity;
    }
}


// Resize canvas with window ↗️

function resizeCanvas() {
    const canvas = renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (canvas.width !== width || canvas.height !== height) {
      console.log(`canvas dimensions: ${width}x${height}; aspect ratio: ${Math.round(width / height * 100) / 100}`)
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      sky_uniforms.u_resolution.value.x = width;
      sky_uniforms.u_resolution.value.y = height;
      ground_uniforms.u_resolution.value.x = width;
      ground_uniforms.u_resolution.value.y = height;
      stars_uniforms.u_resolution.value.x = width;
      stars_uniforms.u_resolution.value.y = height;
    }
}

// Generic reference world-position vector
var wpVector = new THREE.Vector3();


// Animate here 🎬

function animate(time) {
    var time = performance.now();
    time *= 0.001; // convert ms to seconds

    // Put in shader uniform objects update function?
    sky_uniforms.u_time.value = time;
    stars_uniforms.u_time.value = time;

    resizeCanvas();

    // Put in SceneManager:
    controls.update(); // damping


    // Animate unit pointing 🔭
    // Put in unit init and update functions for now

    var dec_axis;
    var ra_axis;
    var lat;
    var mount;
    var pier;

    if (unit) {
        dec_axis = unit.getObjectByName("empty_dec", true); // aka head unit
        ra_axis = unit.getObjectByName("empty_ra", true);
        lat = unit.getObjectByName("empty_lat", true);
        mount = unit.getObjectByName("empty_mount", true);
        pier = unit.getObjectByName("empty_pier", true);

        ra_axis.rotation.x = degreesToRadians(guiControls.RA);
        dec_axis.rotation.y = degreesToRadians(guiControls.Dec);
        lat.rotation.z = degreesToRadians(guiControls.Latitude) * -1;

        
        // line.rotation.x = degreesToRadians(guiControls.RA);
        // line.rotation.y = degreesToRadians(guiControls.Dec  + 180) * 1;
        // line.rotation.z = degreesToRadians(guiControls.Latitude);
    }

    // Update sun position (get from DB later.)
    sunAltitude = Math.floor(guiControls.Sun * 1000) / 1000;

    // stars.rotation.y = 0.00007 * time;
    // stars.rotation.y = 0.7 * time

    // 
    if (sunAltitude != previousSunAltitude) {
        // Update sky colors 🌅
        // Should I only try to do these sorta updates if the sun actually moved a lot (ie. some fraction of a degree)?
        update_colors(sky_uniforms, ground_uniforms, blend_sky_colors(sunAltitude, sun_thresholds, sky_colors));
        // console.log(sunAltitude);
        previousSunAltitude = sunAltitude;
        console.log(sunAltitude);

        setStarVisibility();
    }


    // // ...then redraw it + change lighting too

    if (unitLatitude != guiControls.Latitude) {
    // Update scene with new latitude set from the GUI
    // Specifically, update stars shader latitude uniform (convert to rad first)
    stars_uniforms.u_unitLatitude.value = -1. * degreesToRadians(guiControls.Latitude);
    unitLatitude = guiControls.Latitude;
    }

    // Rotate stars :D (ie. depending time and your longitude)
    if (diurnal != guiControls.Diurnal) {
      stars_uniforms.u_diurnal.value = degreesToRadians(guiControls.Diurnal);
      diurnal = guiControls.Diurnal;
      console.log(diurnal);
    }

    // I think the below weather and debugging stuff belong (or at least need to be called) in SceneManager too

    // Toggle clouds ☁️
    if (clouds) {
        if (guiControls.Cloudy) {
            clouds.visible = true;
            clouds.rotation.y += 0.00023;
        } else {
            clouds.visible = false;
        }
    }

    // if (stars) {
    //   stars.rotation.z = degreesToRadians(90 - guiControls.Latitude)
    // }

    // Toggle axes ✖️
    if (axesHelper) {
        if (guiControls.Axes) {
            axesHelper.visible = true;
        } else {
            axesHelper.visible = false;
        }
    }

    if(control_box) {
        let cameraY = camera.getWorldPosition(wpVector).y;
        cameraY = Math.round(cameraY * 100) / 100;
        // console.log(cameraY);

        if (cameraY < -0.01 && envOpacity >= 0.1) {
            envOpacity < 0.2 ? envOpacity = 0. : envOpacity -= 0.1;
            updateOpacity(control_box, envOpacity);
            // updateOpacity(environment, envOpacity);
        } else if (cameraY > -0.01 && envOpacity <= 0.9) {
            envOpacity > 0.8 ? envOpacity = 1. : envOpacity += 0.1;
            updateOpacity(control_box, envOpacity);
            // updateOpacity(environment, envOpacity);
        }

        // console.log(envOpacity);
    }

    if(line) {
        if (cameraRotX != guiControls.CameraRotX) {
            line.translateX(-3.6);
            line.rotation.x = degreesToRadians(guiControls.CameraRotX);
            line.translateX(3.6);
            cameraRotX = guiControls.CameraRotX;
        }

        if (cameraRotY != guiControls.CameraRotY) {
            line.translateX(-3.6);
            line.rotation.y = degreesToRadians(guiControls.CameraRotY);
            line.translateX(3.6);
            cameraRotY = guiControls.CameraRotY;
        }

        if (cameraRotZ != guiControls.CameraRotZ) {
            line.translateX(-3.6);
            line.rotation.z = degreesToRadians(guiControls.CameraRotZ);
            line.translateX(3.6);
            cameraRotZ = guiControls.CameraRotZ;
        }


        // line.translateX(-3.6);
        
        
        
        // line.translateX(3.6);
        
    }

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
    // sceneManager.update();
}

requestAnimationFrame(animate);