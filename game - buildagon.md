# Buildagon

### **Game Overview**

Build a cozy, relaxing sandbox building game.  No set story, survival pressure, or combat objectives; the main focus is open-ended environmental building and atmospheric design. 

### **Core Gameplay Mechanics**

#### **1. Grid-Based World Foundation**

- **Hexagon Grid:** Ground tiles, lakes, water channels, bridges, and waterfalls are placed along a hexagonal grid system to allow for structured landscape formation.    
- **Structural Elements:** Includes modular components like walls, ceilings, and roofs that enable players to design custom buildings and structures within their environment.
#### **2. Freeform & Snapping Decoration**

- **Freeform Placement:** Foliage (plants, trees), rocks, and other decorative elements can be placed freely without rigid grid locks to create a natural, organic look.
- **Grid Snapping Mode:** Toggleable placement (`G`) to align objects precisely when constructing symmetrical or neat structures.
- **Variant Switching:** Players can cycle through different variants/styles of decorations on the fly (`F`) to add diversity to their landscapes.
#### **3. Environmental & Audio Dynamics**

- **Dynamic Weather & Physics:** Features responsive wind physics that interact with grass and foliage.
- **Day/Night Cycle:** Immerses players in changing lighting conditions over time.
- **Atmosphere & Audio:** Custom UI sound effects enhance the tactile feedback while building.
#### **4. Camera & Player Controls**

- **Free-Cam Navigation:** Players control a flying camera to navigate and view their creations easily from multiple angles.
    - **Movement:** `WASD` (Move), `Q`/`E` (Height adjustments).
    - **Camera Speed:** Hold `Shift` to slow down for detailed work; hold `Ctrl` to speed up navigation.
    - **Rotation & Action:** Scroll Wheel or Arrow Keys to rotate building blueprints; `C` to open the build menu; `V` to activate destroy mode.
#### **5. Multiplayer & World Management**

- **Save / Load System:** Allows players to store their creations and load them later.    
- (FUTURE) **Co-op Building & Discovery:** Offers multiplayer building support along with a server discovery feature to visit other players' sandboxes.

####  **6. Dual Placement System (Hybrid Grid & Freeform)**

The game's building mechanics rely on two distinct placement modes depending on the structural object being used:

- **Hexagonal Grid Snapping:** Terrain modifications, water tiles (lakes, streams, waterfalls), bridges, and structural foundations automatically snap to a hexagonal grid layout. This allows players to create clean, seamlessly connected landscapes and waterways without gaps or overlapping geometry.
- **Freeform Decoration Mode:** Smaller environmental decorations—such as individual plants, flower beds, rocks, and trees—disable grid locks. Players can freely position and rotate them anywhere on top of terrain or structures to create a natural, hand-crafted look.

#### **7. Dynamic Blueprint Manipulation**

When selecting an item from the building menu, a visual **blueprint ghost/outline** appears in front of the camera:

- **Real-time Blueprint Rotation:** Players can continuously rotate blueprints using the mouse scroll wheel or keyboard controls before confirming placement.    
- **Variant Toggling:** With a single keypress (`F`), players can cycle through visual style variations for a selected decoration model directly from the placement preview without needing to reopen the build menu.
- **Toggleable Snap Alignment:** A shortcut (`G`) lets players switch between strict grid-alignment and freeform snapping on demand, giving total control over precise or organic object placement.
    
#### **8. Deconstruction & Hotbar Customization**

- **Instant Demolition Mode:** Switching into destroy mode (`V`) changes the active cursor/blueprint tool into a removal indicator, letting players quickly clean up unwanted grid tiles or misplaced decorations.
- **Hotkey & Preset Hotbars:** Players can quickly switch between hotbar configurations (`H` / Numpad keys) to keep different sets of building materials or vegetation styles immediately accessible while designing large maps.

#### **9. Camera Mobility & Environmental Feedback**

- **Unconstrained Fly-Cam:** Placement is performed entirely via a free-floating sandbox camera rather than a grounded character model, allowing precision placement on elevated cliffs or underwater beds.
- **Live Environmental Physics:** As items and terrain tiles are placed, dynamic wind effects immediately cause surrounding grass and leaves to rustle, accompanied by custom placement sound effects.

### Placement Animation

- **Ghost/Blueprint Projection:** Before an item is placed, a semi-transparent, color-coded outline (blueprint preview) hovers in front of the camera, tracking smoothly along the hexagonal grid or terrain geometry to show exact alignment.
- **Elastic "Pop" Impact (Squash & Stretch):** When a structure or decoration is confirmed, the object doesn't just instantly appear. It pops into existence with a slight spring-like recoil (squash and stretch effect), making each drop feel responsive and satisfying.
- **Particle & Dust Feedback:** Placing ground tiles, rocks, or heavy structures triggers subtle dust or puff particle effects at the base of the object, anchoring it visually into the terrain.
- **Seamless Grid Merging:** When hexagonal water or land tiles are laid down adjacent to existing tiles, the edges dynamically morph and blend together in real time, creating smooth rivers and continuous shorelines rather than harsh tile borders.
- **Immediate Foliage Activation:** Placing plants or trees instantly triggers active wind physics, causing the newly placed flora to immediately rustle and sway in harmony with the surrounding vegetation.

### **Key Shader & Lighting Elements**

The visual style should be a cel-shaded flat aesthetic.

- **Flat-Shaded / Unlit Texture Palette:** Materials rely almost entirely on solid pastel color blocks rather than detailed surface textures (e.g., wood grain or stone bumps). Geometry relies on clean face colors. The shader styling should rely on a clean, low-poly aesthetic enhanced by modern atmospheric lighting and real-time shader effects:
- **Stylized Low-Poly Aesthetic:** Surfaces use smooth, flat-shaded gradients rather than high-resolution realistic textures, giving the entire environment a clean, hand-crafted toy or diorama feel.
- **Dynamic Foliage & Wind Vertex Shaders:** Grass, tree leaves, and bushes use custom vertex displacement shaders that deform the mesh continuously. This simulates gentle wind passing through the foliage, creating organic motion without severe performance costs.
- **Translucent Water Shader:** Water tiles feature subsurface depth-fading, soft shore foam blending where the water meets hexagonal terrain, and gentle directional surface waves.
- **Volumetric Fog & Soft Lighting:** The day/night lighting pipeline incorporates soft volumetric fog and bloom, casting long, diffuse shadows across terrain and structures to heighten the cozy, atmospheric mood.

### Water Mechanics

1. Hexagonal Grid Placement: Tile-Based Snapping: Water bodies—such as lakes, ponds, and river channels—are placed using hexagonal grid tiles. Placing tiles adjacent to each other seamlessly connects them into unified bodies of water. Smart Edge Blending: Rather than looking like isolated polygonal blocks, adjacent water tiles dynamically blend their edges together to form organic, continuous shorelines and riverbanks.
2. Multi-Level Elevation & Waterfalls: Vertical Connections: Players can construct elevated water features like cliffside lakes or raised streams. Dynamic Waterfall Generation: When a water tile is placed at an elevation boundary directly adjacent to a lower tile, the system automatically spawns cascading waterfall visuals that bridge the two height levels without requiring manual alignment.
3. Visual & Shader Effects: Translucent Depth & Shore Foam: The water shader includes depth fading that makes shallow areas near banks lighter and deep sections darker. Where water meets land or rocks, a soft foam line dynamically renders along the perimeter. Surface Waves & Motion: The water surface features animated wave displacement shaders that produce a soft, rhythmic movement.
4. Object Interaction & Freeform Placement: Decorating Water Bodies: Freeform props like lilies, water plants, rocks, and small wooden bridges can be placed directly on or inside water tiles. Bridge Snapping: Structural elements like wooden walkways or bridges align across water channels to allow seamless pathways across created lakes.