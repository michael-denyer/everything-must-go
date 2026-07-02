import * as THREE from 'three';
import { CAM_FOV, CAM_POS } from './config';

export function createScene(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAM_FOV, innerWidth / innerHeight, 0.1, 100);
  camera.position.set(...CAM_POS);
  camera.lookAt(0, 0, 0);
  return { scene, camera };
}
