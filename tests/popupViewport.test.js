import test from 'node:test';
import assert from 'node:assert/strict';
import {popupViewportBounds, installPopupViewport} from '../src/lib/popupViewport.js';

test('uses the keyboard-reduced viewport and its pan offset', () => {
  assert.deepEqual(popupViewportBounds({width: 430, height: 370, offsetTop: 82, offsetLeft: 0}, 430, 932),
    {width: 430, height: 370, top: 82, left: 0});
});

test('falls back to window dimensions without VisualViewport', () => {
  assert.deepEqual(popupViewportBounds(null, 430, 932), {width: 430, height: 932, top: 0, left: 0});
});

test('updates on keyboard resize, reveals a lower field, and cleans up', () => {
  const viewport = new EventTarget();
  Object.assign(viewport, {width: 430, height: 932, offsetTop: 0, offsetLeft: 0});
  const win = new EventTarget();
  const frames = new Map();
  let nextId = 0;
  Object.assign(win, {visualViewport: viewport, innerWidth: 430, innerHeight: 932,
    requestAnimationFrame: callback => {frames.set(++nextId, callback); return nextId;},
    cancelAnimationFrame: id => frames.delete(id)});
  const doc = new EventTarget();
  const values = new Map();
  doc.documentElement = {style: {setProperty: (key, value) => values.set(key, value), removeProperty: key => values.delete(key)}};
  const modal = {clientTop: 1, clientHeight: 300, scrollTop: 0, getBoundingClientRect: () => ({top: 100})};
  doc.activeElement = {closest: () => modal, getBoundingClientRect: () => ({top: 420, bottom: 460, height: 40})};
  const flush = () => {const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback());};
  const stop = installPopupViewport(win, doc);
  flush();
  viewport.height = 370;
  viewport.offsetTop = 82;
  viewport.dispatchEvent(new Event('resize'));
  flush();
  assert.equal(values.get('--popup-viewport-height'), '370px');
  assert.equal(values.get('--popup-viewport-top'), '82px');
  flush();
  assert.equal(modal.scrollTop, 75);
  doc.activeElement = null;
  viewport.height = 932;
  viewport.offsetTop = 0;
  viewport.dispatchEvent(new Event('resize'));
  flush();
  assert.equal(values.get('--popup-viewport-height'), '932px');
  assert.equal(values.get('--popup-viewport-top'), '0px');
  stop();
  viewport.dispatchEvent(new Event('resize'));
  assert.equal(frames.size, 0);
  assert.equal(values.size, 0);
});
