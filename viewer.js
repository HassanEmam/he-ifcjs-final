import { projects } from "./projects.js";
import {
  AmbientLight,
  AxesHelper,
  DirectionalLight,
  GridHelper,
  PerspectiveCamera,
  Scene,
  Raycaster,
  Vector2,
  WebGLRenderer,
  MeshLambertMaterial,
} from "three";

import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from "three-mesh-bvh";

import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { IFCLoader } from "web-ifc-three/IFCLoader";

// Get the current project ID from the URL parameter
const currentUrl = window.location.href;
const url = new URL(currentUrl);
const currentProjectID = url.searchParams.get("id");
let preselectModel = { id: -1 };
const propertiesDiv = document.getElementById("properties");
propertiesDiv.style.display = "none";
const preselectMat = new MeshLambertMaterial({
  transparent: true,
  opacity: 0.9,
  color: 0xff88ff,
  depthTest: true,
});

// Get the current project
const currentProject = projects.find(
  (project) => project.id === currentProjectID
);
const projectURL = currentProject.url;
const title = document.getElementById("title");
title.innerText = currentProject.name;
// get the canvas container
const threeCanvas = document.getElementById("model-viewer-container");

//Creates the Three.js scene
const scene = new Scene();

//Object to store the size of the viewport
const size = {
  width: window.innerWidth,
  height: window.innerHeight,
};

//Creates the camera (point of view of the user)
const camera = new PerspectiveCamera(75, size.width / size.height);
camera.position.z = 15;
camera.position.y = 13;
camera.position.x = 8;

//Creates the lights of the scene
const lightColor = 0xffffff;

const ambientLight = new AmbientLight(lightColor, 0.5);
scene.add(ambientLight);

const directionalLight = new DirectionalLight(lightColor, 2);
directionalLight.position.set(0, 10, 0);
scene.add(directionalLight);

//Sets up the renderer, fetching the canvas of the HTML
// const threeCanvas = document.getElementById("three-canvas");
const renderer = new WebGLRenderer();
renderer.setClearColor(0xffffff);
threeCanvas.appendChild(renderer.domElement);
renderer.setSize(size.width, size.height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

//Creates grids and axes in the scene
const grid = new GridHelper(50, 30);
scene.add(grid);

const axes = new AxesHelper();
axes.material.depthTest = false;
axes.renderOrder = 1;
scene.add(axes);

//Creates the orbit controls (to navigate the scene)
const controls = new OrbitControls(camera, threeCanvas);
controls.enableDamping = true;
controls.target.set(-2, 0, 0);
const ifcModels = [];
const ifcLoader = new IFCLoader();
let model = null;
// const ifcURL = URL.createObjectURL();
async function loadIfc() {
  await ifcLoader.loadAsync(projectURL).then((m) => {
    model = m;
    scene.add(m);
    ifcModels.push(m);
    return m;
  });
}
let spatial = null;
async function init() {
  await loadIfc();
  spatial = await ifcLoader.ifcManager.getSpatialStructure(model.modelID);
  createTreeMenu(spatial);
  threeCanvas.onmousemove = (event) => {
    const found = cast(event)[0];
    highlight(found, preselectMat, preselectModel);
  };
  const ulItem = document.getElementById("myUL");
  ulItem.animate({ scrollTop: ulItem.scrollHeight }, 1000);
}

init();

// Tree view

const toggler = document.getElementsByClassName("caret");
for (let i = 0; i < toggler.length; i++) {
  toggler[i].onclick = () => {
    toggler[i].parentElement
      .querySelector(".nested")
      .classList.toggle("active");
    toggler[i].classList.toggle("caret-down");
  };
}

// Spatial tree menu

function createTreeMenu(ifcProject) {
  const root = document.getElementById("tree-root");
  removeAllChildren(root);
  const ifcProjectNode = createNestedChild(root, ifcProject);
  ifcProject.children.forEach((child) => {
    constructTreeMenuNode(ifcProjectNode, child);
  });
}

function nodeToString(node) {
  return `${node.type} - ${node.expressID}`;
}

function constructTreeMenuNode(parent, node) {
  const children = node.children;
  if (children.length === 0) {
    createSimpleChild(parent, node);
    return;
  }
  const nodeElement = createNestedChild(parent, node);
  children.forEach((child) => {
    constructTreeMenuNode(nodeElement, child);
  });
}

function createNestedChild(parent, node) {
  const content = nodeToString(node);
  const root = document.createElement("li");
  createTitle(root, content);
  const childrenContainer = document.createElement("ul");
  childrenContainer.classList.add("nested");
  root.appendChild(childrenContainer);
  parent.appendChild(root);
  return childrenContainer;
}

function createTitle(parent, content) {
  const title = document.createElement("span");
  title.classList.add("caret");
  title.onclick = () => {
    title.parentElement.querySelector(".nested").classList.toggle("active");
    title.classList.toggle("caret-down");
  };
  title.textContent = content;
  parent.appendChild(title);
}

function createSimpleChild(parent, node) {
  const content = nodeToString(node);
  const childNode = document.createElement("li");
  childNode.setAttribute("id", node.expressID);
  childNode.classList.add("leaf-node");
  childNode.textContent = content;
  parent.appendChild(childNode);

  childNode.onmouseenter = async () => {
    removeTmpHighlights();
    childNode.classList.add("tmphighlight");
    highlightFromSpatial(node.expressID);
  };

  childNode.onclick = async () => {
    removeHighlights();
    childNode.classList.add("highlight");
    highlightFromSpatial(node.expressID);
    selectedElementId = node.expressID;
    updateProperties();
    // ifcLoader.ifcManager.prepickIfcItemsByID(0, [node.expressID]);
  };
}

function removeHighlights() {
  const highlighted = document.getElementsByClassName("highlight");
  for (let h of highlighted) {
    if (h) {
      h.classList.remove("highlight");
    }
  }
}

function removeTmpHighlights() {
  const highlighted = document.getElementsByClassName("tmphighlight");
  for (let h of highlighted) {
    if (h) {
      h.classList.remove("tmphighlight");
    }
  }
}

function removeAllChildren(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

const raycaster = new Raycaster();
raycaster.firstHitOnly = true;
const mouse = new Vector2();

function cast(event) {
  // Computes the position of the mouse on the screen
  const bounds = threeCanvas.getBoundingClientRect();

  const x1 = event.clientX - bounds.left;
  const x2 = bounds.right - bounds.left;
  mouse.x = (x1 / x2) * 2 - 1;

  const y1 = event.clientY - bounds.top;
  const y2 = bounds.bottom - bounds.top;
  mouse.y = -(y1 / y2) * 2 + 1;

  // Places it on the camera pointing to the mouse
  raycaster.setFromCamera(mouse, camera);

  // Casts a ray
  return raycaster.intersectObjects(ifcModels);
}

let selectedElementId = null;
async function pick(event) {
  const found = cast(event)[0];
  if (found) {
    const index = found.faceIndex;
    const geometry = found.object.geometry;
    const ifc = ifcLoader.ifcManager;
    const id = ifcLoader.ifcManager.getExpressId(geometry, index);
    selectedElementId = id;
    await updateProperties();
    propertiesDiv.style.display = "block";
  }
}

function highlightFromSpatial(id) {
  ifcLoader.ifcManager.createSubset({
    modelID: model.modelID,
    ids: [id],
    material: preselectMat,
    scene: scene,
    removePrevious: true,
  });
}
function highlight(found, material, model) {
  const modelId = model.modelID;
  if (found) {
    // Gets model ID
    const modelId = found.object.modelID;

    // Gets Express ID
    const index = found.faceIndex;
    const geometry = found.object.geometry;
    const id = ifcLoader.ifcManager.getExpressId(geometry, index);

    // Creates subset
    ifcLoader.ifcManager.createSubset({
      modelID: modelId,
      ids: [id],
      material: material,
      scene: scene,
      removePrevious: true,
    });
  } else {
    // Removes previous highlight
    ifcLoader.ifcManager.removeSubset(modelId, material);
  }
}

threeCanvas.ondblclick = (event) => pick(event);

//Animation loop
const animate = () => {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
};

animate();

//Adjust the viewport to the size of the browser
window.addEventListener("resize", () => {
  (size.width = window.innerWidth), (size.height = window.innerHeight);
  camera.aspect = size.width / size.height;
  camera.updateProjectionMatrix();

  renderer.setSize(size.width, size.height);
});

const tabs = document.getElementsByClassName("tablinks");

for (const tab of tabs) {
  tab.addEventListener("click", (event) => {
    openTab(event, tab.value);
  });
}

async function openTab(evt, cityName) {
  // Declare all variables
  updateProperties();
  var i, tabcontent, tablinks;

  // Get all elements with class="tabcontent" and hide them
  tabcontent = document.getElementsByClassName("tabcontent");
  for (i = 0; i < tabcontent.length; i++) {
    tabcontent[i].style.display = "none";
  }

  // Get all elements with class="tablinks" and remove the class "active"
  tablinks = document.getElementsByClassName("tablinks");
  for (i = 0; i < tablinks.length; i++) {
    tablinks[i].className = tablinks[i].className.replace(" active", "");
  }

  const activeTab = document.getElementById(cityName);

  // Show the current tab, and add an "active" class to the button that opened the tab
  activeTab.style.display = "block";
  evt.currentTarget.className += " active";
}

async function updateProperties() {
  const attributesTab = document.getElementById("Attributes");
  const psetsTab = document.getElementById("psets");
  const materialsTab = document.getElementById("Materials");
  const psets = await ifcLoader.ifcManager.getPropertySets(
    model.modelID,
    selectedElementId,
    true
  );

  const npropDiv = document.createElement("div");
  psetsTab.innerHTML = "";
  psetsTab.appendChild(await psets2html(psets));
  psetsTab.appendChild(npropDiv);

  const props = await ifcLoader.ifcManager.getItemProperties(
    model.modelID,
    selectedElementId,
    true
  );
  const propDiv = document.createElement("div");
  attributesTab.innerHTML = "";
  propDiv.appendChild(await attr2html(props));
  attributesTab.appendChild(propDiv);
  activateCollapsible();

  const materialprop = await ifcLoader.ifcManager.getMaterialsProperties(
    model.modelID,
    selectedElementId,
    true
  );
  const matDive = document.createElement("div");
  materialsTab.innerHTML = "";
  matDive.appendChild(await material2html(materialprop));
  materialsTab.appendChild(matDive);
  console.log(materialprop);
}

async function material2html(materials) {
  const div = document.createElement("div");
  const table = document.createElement("table");
  const header = document.createElement("tr");
  header.innerHTML = `<th>Material</th><th>Thickness</th>`;

  for (const material of materials) {
    // console.log(material.ForLayerSet.MaterialLayers);
    if (material.ForLayerSet) {
      table.appendChild(header);
      for (const mat of material.ForLayerSet.MaterialLayers) {
        console.log(mat.Material.Name.value, mat.LayerThickness.value);
        const row = document.createElement("tr");
        row.innerHTML = `<td>${mat.Material.Name.value}</td><td>${
          Math.round(mat.LayerThickness.value * 1000) / 1000
        }</td>`;
        table.appendChild(row);
      }
    }
  }
  div.appendChild(table);
  console.log(div);
  return div;
}

async function attr2html(element) {
  const html = document.createElement("table");
  const header = document.createElement("tr");
  header.innerHTML = `<th>Name</th><th>Value</th>`;
  html.appendChild(header);
  const guid = element.GlobalId.value;
  const guidRow = document.createElement("tr");
  guidRow.innerHTML = `<td>GlobalId</td><td>${guid}</td>`;
  const expressID = element.expressID;
  const expressIDRow = document.createElement("tr");
  expressIDRow.innerHTML = `<td>ExpressId</td><td>${expressID}</td>`;
  html.appendChild(guidRow);
  html.appendChild(expressIDRow);
  const name = element.Name.value;
  const nameRow = document.createElement("tr");
  nameRow.innerHTML = `<td>Name</td><td>${name}</td>`;
  html.appendChild(nameRow);
  const ifcType = element.__proto__.constructor.name;
  const ifcTypeRow = document.createElement("tr");
  ifcTypeRow.innerHTML = `<td>IfcType</td><td>${ifcType}</td>`;
  html.appendChild(ifcTypeRow);
  const type = element.ObjectType.value;
  const typeRow = document.createElement("tr");
  typeRow.innerHTML = `<td>Type</td><td>${type}</td>`;
  html.appendChild(typeRow);
  const tag = element.Tag.value;
  const tagRow = document.createElement("tr");
  tagRow.innerHTML = `<td>Tag</td><td>${tag}</td>`;
  html.appendChild(tagRow);

  return html;
}

async function psets2html(psets) {
  const html = document.createElement("div");
  for (const pset of psets) {
    const psetDiv = document.createElement("div");
    psetDiv.setAttribute("class", "collapsible");
    psetDiv.innerHTML = `${pset.Name.value}`;

    const psetContent = document.createElement("div");
    psetContent.setAttribute("class", "col-content");
    const psetTable = document.createElement("table");
    const header = document.createElement("tr");
    header.innerHTML = `<th>Name</th><th>Value</th>`;
    psetTable.appendChild(header);
    for (const prop of pset.HasProperties) {
      const row = document.createElement("tr");
      row.innerHTML = `<td>${prop.Name.value ? prop.Name.value : ""}</td>
      <td>${prop.NominalValue ? prop.NominalValue.value : ""}</td>`;
      psetTable.appendChild(row);
    }
    html.appendChild(psetDiv);
    psetContent.appendChild(psetTable);
    html.appendChild(psetContent);
  }
  return html;
}

function activateCollapsible() {
  var coll = document.getElementsByClassName("collapsible");
  var i;
  for (i = 0; i < coll.length; i++) {
    coll[i].addEventListener("click", function () {
      this.classList.toggle("colactive");
      var content = this.nextElementSibling;
      if (content.style.display === "block") {
        content.style.display = "none";
      } else {
        content.style.display = "block";
      }
    });
  }
}
