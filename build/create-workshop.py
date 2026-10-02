"""Build the original rigid-joint workshop rig and bake its scroll performance.

Run with Blender 5.1: blender --background --python build/create-workshop.py
Units are metres, Blender Z-up. glTF export performs the Y-up conversion.
"""
import math
from pathlib import Path
import bpy
from mathutils import Vector, Euler

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "3d"
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
bpy.context.preferences.filepaths.save_version = 0
scene.render.fps = 30
scene.frame_start, scene.frame_end = 1, 901
scene.name = "Workshop"


def material(name, color, metal=0, rough=0.4, emission=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    shader = m.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Metallic"].default_value = metal
    shader.inputs["Roughness"].default_value = rough
    shader.inputs["Emission Color"].default_value = (*color, 1)
    shader.inputs["Emission Strength"].default_value = emission
    return m


shell = material("Ceramic | warm white", (0.76, 0.8, 0.79), 0.12, 0.31)
dark = material("Graphite | joints", (0.055, 0.069, 0.074), 0.65, 0.34)
rubber = material("Rubber | wheels", (0.018, 0.023, 0.025), 0.05, 0.82)
metal = material("Brushed aluminium", (0.36, 0.43, 0.46), 0.82, 0.36)
teal = material("Signal | teal", (0.04, 0.65, 0.53), 0.35, 0.3, 1.1)
red = material("Safety | vermilion", (0.76, 0.12, 0.055), 0.25, 0.4)
glass = material("Optical glass", (0.008, 0.025, 0.032), 0.7, 0.12)
pcb = material("Solder mask", (0.035, 0.21, 0.15), 0.35, 0.4)
gold = material("Copper contacts", (0.62, 0.38, 0.12), 0.85, 0.24)
benchmat = material("Worktop", (0.14, 0.17, 0.18), 0.65, 0.4)


def group(name, loc=(0, 0, 0), parent=None):
    o = bpy.data.objects.new(name, None)
    scene.collection.objects.link(o)
    o.parent = parent
    o.location = loc
    return o


def finish(o, name, mat, parent, loc):
    o.name = name
    o.parent = parent
    o.location = loc
    o.data.materials.append(mat)
    return o


def box(name, loc, size, mat=shell, bevel=0.04, parent=None):
    bpy.ops.mesh.primitive_cube_add()
    o = bpy.context.object
    o.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for poly in o.data.polygons:
        poly.use_smooth = True
    if bevel:
        mod = o.modifiers.new("Manufactured edge radii", "BEVEL")
        mod.width, mod.segments = bevel, 3
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod = o.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(o, name, mat, parent, loc)


def cyl(name, loc, radius, depth, mat=metal, parent=None, axis="Z", vertices=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth)
    o = finish(bpy.context.object, name, mat, parent, loc)
    if axis == "X": o.rotation_euler.y = math.pi / 2
    if axis == "Y": o.rotation_euler.x = math.pi / 2
    for poly in o.data.polygons:
        poly.use_smooth = len(poly.vertices) == 4
    mod = o.modifiers.new("Machined edge", "BEVEL")
    mod.width, mod.segments = min(0.012, radius * 0.15), 2
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=mod.name)
    mod = o.modifiers.new("Weighted corner normals", "WEIGHTED_NORMAL")
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return o


def cable(name, points, radius, mat=dark, parent=None):
    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.resolution_u = 8
    data.bevel_depth = radius
    data.bevel_resolution = 2
    spline = data.splines.new("BEZIER")
    spline.bezier_points.add(len(points)-1)
    for knot, point in zip(spline.bezier_points, points):
        knot.co = point
        knot.handle_left_type = knot.handle_right_type = "AUTO"
    o = bpy.data.objects.new(name, data)
    scene.collection.objects.link(o)
    o.parent = parent
    data.materials.append(mat)
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target="MESH")
    o.select_set(False)
    return o


def key(o, frame):
    o.rotation_mode = "QUATERNION"
    o.keyframe_insert("location", frame=frame)
    o.keyframe_insert("rotation_quaternion", frame=frame)


def label(name, text, loc, size, mat, parent=None):
    data=bpy.data.curves.new(name,"FONT")
    data.body=text
    data.size=size
    data.extrude=.0005
    data.resolution_u=3
    o=bpy.data.objects.new(name,data)
    scene.collection.objects.link(o)
    o.parent=parent
    o.location=loc
    o.rotation_euler.x=math.pi/2
    data.materials.append(mat)
    bpy.context.view_layer.objects.active=o
    o.select_set(True)
    bpy.ops.object.convert(target="MESH")
    o.select_set(False)
    return o


def smooth(a, b, x):
    t = max(0, min(1, (x-a)/(b-a)))
    return t*t*(3-2*t)


def lerp(a, b, t):
    return Vector(a).lerp(Vector(b), t)


robot = group("RobotRoot")
box("Chassis", (0, 0, 0.47), (1.34, 0.99, 0.34), dark, 0.12, robot)
box("Lower shell", (0, -0.04, 0.66), (1.12, 0.9, 0.2), shell, 0.09, robot)
box("Bumper", (0, -0.53, 0.44), (0.92, 0.09, 0.12), rubber, 0.04, robot)
wheels=[]
for x in (-0.68, 0.68):
    for y in (-0.31, 0.31):
        wheel=group("WheelJoint",(x,y,.3),robot)
        wheels.append(wheel)
        cyl("Wheel", (0, 0, 0), 0.29, 0.19, rubber, wheel, "X")
        for i in range(16):
            angle=i*math.tau/16
            tread=box("Tire tread",(0,math.sin(angle)*.284,math.cos(angle)*.284),(.2,.065,.022),rubber,.008,wheel)
            tread.rotation_euler.x=-angle
        cyl("Wheel hub", (x*1.14, y, 0.3), 0.155, 0.027, metal, robot, "X")
        cyl("Axle cap", (x*1.17, y, 0.3), 0.065, 0.034, dark, robot, "X")
cyl("Waist bearing", (0, 0, 0.85), 0.32, 0.22, metal, robot)
for z in (.77,.82,.87,.92):
    cyl("Waist seal",(0,0,z),.328,.016,rubber,robot)
for x in (-.50,.50):
    box("Chassis service plate",(x,-.02,.72),(.14,.54,.025),metal,.015,robot)
    for y in (-.2,.2):
        cyl("Service screw",(x,y,.739),.018,.012,dark,robot,vertices=8)
box("Torso", (0, 0, 1.37), (1.07, 0.69, 0.92), shell, 0.16, robot)
box("Chest inset", (0, -0.35, 1.44), (0.74, 0.045, 0.34), dark, 0.04, robot)
for i in range(5):
    box("Power indicator", (-0.25+i*0.125, -0.38, 1.46), (0.072, 0.015, 0.03), teal, 0.007, robot)
box("Emergency stop", (0.28, -0.38, 1.14), (0.12, 0.035, 0.09), red, 0.015, robot)
label("Identity", "BL / 01", (-.30,-.381,1.33), .085, shell, robot)
label("Body ID", "FIELD ENGINEERING", (-.35,-.348,1.05), .039, dark, robot)
for i in range(6):
    box("Air intake",(-.30+i*.075,.349,1.40),(.035,.023,.30),dark,.007,robot)
for x in (-.39,.39):
    box("Shell seam",(x,-.318,1.21),(.01,.03,.16),dark,.003,robot)
for x in (-0.4, 0.4):
    for z in (1.03, 1.73):
        cyl("Torso fastener", (x, -0.325, z), 0.022, 0.028, metal, robot, "Y", 12)
cyl("Neck", (0, 0, 1.93), 0.19, 0.27, dark, robot)
head = group("HeadJoint", (0, 0, 2.18), robot)
box("Optical housing", (0, 0, 0), (0.95, 0.62, 0.49), shell, 0.12, head)
box("Visor", (0, -0.315, 0), (0.76, 0.055, 0.29), glass, 0.07, head)
box("Visor gasket",(0,-.302,0),(.80,.025,.33),rubber,.065,head)
box("Optical brow",(0,-.24,.225),(.66,.28,.035),metal,.015,head)
label("Optics marking","STEREO / 01",(-.17,-.323,.17),.027,dark,head)
for x in (-0.21, 0.21):
    cyl("Lens barrel", (x, -0.355, 0.01), 0.099, 0.035, metal, head, "Y")
    cyl("Lens", (x, -0.377, 0.01), 0.072, 0.02, glass, head, "Y")
    cyl("Lens inner ring",(x,-.389,.01),.052,.01,dark,head,"Y")
    cyl("Optical signal", (x, -0.391, 0.01), 0.029, 0.007, teal, head, "Y")
for x in (-0.48, 0.48):
    cyl("Head pivot", (x, 0, 0), 0.125, 0.025, metal, head, "X")

arms = []
fingers = []
for side in (-1, 1):
    shoulder = (side*0.64, 0, 1.69)
    cyl("Shoulder bearing", shoulder, 0.19, 0.2, dark, robot, "X")
    cyl("Shoulder outer cap",(side*.76,0,1.69),.145,.035,metal,robot,"X")
    upper = group("UpperArm_"+str(side), shoulder, robot)
    box("Upper arm shell", (0, 0, 0.4), (0.24, 0.27, 0.8), shell, 0.055, upper)
    box("Arm rail", (0, -0.146, 0.29), (0.07, 0.026, 0.39), metal, 0.01, upper)
    for z in (.19,.55):
        cyl("Arm service fastener",(0,-.154,z),.024,.02,dark,upper,"Y",8)
    lower = group("Forearm_"+str(side), parent=robot)
    cyl("Elbow", (0, 0, 0), 0.145, 0.28, dark, lower, "Y")
    box("Forearm shell", (0, 0, 0.39), (0.21, 0.23, 0.78), shell, 0.055, lower)
    cyl("Elbow cap",(0,-.16,0),.105,.028,metal,lower,"Y")
    cyl("Elbow spindle",(0,-.18,0),.042,.016,dark,lower,"Y",12)
    cable("Servo loom",[(.10,.10,.08),(.17,.16,.20),(.16,.16,.50),(.10,.10,.66)],.022,rubber,lower)
    box("Forearm service panel",(0,-.124,.43),(.12,.015,.25),metal,.014,lower)
    wrist = group("Grip_"+str(side), parent=robot)
    cyl("Wrist", (0, 0, 0.07), 0.105, 0.15, dark, wrist)
    box("Gripper bridge", (0, 0, 0.17), (0.28, 0.14, 0.08), metal, 0.02, wrist)
    for x in (-0.106, 0.106):
        finger = group("Finger_"+str(side)+"_"+str(x),(x,0,0),wrist)
        fingers.append((finger,side,1 if x>0 else -1))
        box("Gripper finger", (0, 0, 0.26), (0.055, 0.11, 0.18), metal, 0.015, finger)
        box("Contact pad", (-x*.24, 0, 0.32), (0.035, 0.115, 0.075), rubber, 0.007, finger)
    arms.append((shoulder, upper, lower, wrist))

# The driver is parked on its dock, then constrained to the grip while held.
tool = group("Driver")
cyl("Driver body", (0, 0, 0), 0.074, 0.29, dark, tool)
for z in (-.10,-.065,-.03,.005,.04):
    cyl("Driver grip groove",(0,0,z),.078,.012,rubber,tool,vertices=16)
cyl("Driver collar", (0, 0, 0.17), 0.079, 0.045, teal, tool)
driver_spinner = group("DriverSpinner", parent=tool)
cyl("Driver shaft", (0, 0, 0.32), 0.022, 0.26, metal, driver_spinner, vertices=12)
cyl("Driver bit", (0, 0, 0.48), 0.015, 0.065, metal, driver_spinner, vertices=6)


def bench(x):
    b = group("Station_"+str(x), (x, -1.05, 0))
    box("Bench top", (0, 0, 0.98), (2.5, 1.2, 0.13), benchmat, 0.04, b)
    box("Front fascia", (0, -0.605, 0.94), (2.4, 0.025, 0.18), metal, 0.01, b)
    for xx in (-1, 1):
        for yy in (-0.45, 0.45):
            box("Bench leg", (xx, yy, 0.45), (0.085, 0.085, 0.9), dark, 0.01, b)
    box("Bench crossrail",(0,.43,.22),(2.05,.065,.065),metal,.01,b)
    label("Station label", "BILL LU  /  LAB " + str(int(x+1)).zfill(2),(-1.08,-.624,.945),.042,dark,b)
    box("Status stripe",(1.07,-.628,.956),(.13,.012,.055),teal,.005,b)
    return b


boardbench = bench(1.05)
board = box("PCB", (0, 0, 1.07), (1.65, 0.78, 0.045), pcb, 0.02, boardbench)
for x in (-.73,.73):
    for y in (-.30,.30):
        cyl("PCB mounting collar",(x,y,1.106),.035,.012,gold,boardbench,vertices=12)
        cyl("PCB mounting screw",(x,y,1.115),.017,.01,dark,boardbench,vertices=8)
for i in range(12):
    for y in (-.09,.17):
        box("MCU lead",(-.465+i*.021,y,1.126),(.012,.044,.012),metal,.002,boardbench)
for i in range(7):
    box("SMD resistor",(-.68+i*.14,-.29,1.108),(.048,.024,.018),dark,.004,boardbench)
    for dx in (-.023,.023):
        box("Solder joint",(-.68+i*.14+dx,-.29,1.106),(.012,.03,.012),metal,.002,boardbench)
for i,mat in enumerate((red,dark,gold)):
    cable("Motor phase lead",[(.30,-.16+i*.075,1.12),(.38,-.19+i*.075,1.20),(.43,-.07+i*.065,1.28)],.012,mat,boardbench)
for i in range(8):
    box("Copper trace", (-0.68+i*0.18, 0.08, 1.1), (0.018, 0.53, 0.008), gold, 0, boardbench)
    box("Driver package", (-0.68+i*0.18, -0.13, 1.15), (0.12, 0.17, 0.09), dark, 0.007, boardbench)
for x in (-0.55, -0.2, 0.15):
    cyl("Capacitor", (x, 0.23, 1.2), 0.075, 0.21, metal, boardbench)
box("MCU", (-0.35, 0.04, 1.14), (0.27, 0.25, 0.06), dark, 0.01, boardbench)
motor = cyl("Motor housing", (0.58, 0.02, 1.3), 0.19, 0.39, metal, boardbench)
for i in range(8):
    cyl("Motor cooling fin", (0.58, 0.02, 1.14+i*0.044), 0.215, 0.02, dark, boardbench)
fastener = cyl("Fastener", (0.58, 0.02, 1.52), 0.063, 0.045, gold, boardbench, vertices=6)
contact = Vector((1.63, -1.03, 1.5425))
tool_dock = Vector((0.50, -0.7, 1.61))
cyl("Tool cradle", (tool_dock.x, tool_dock.y, 1.15), .09, .20, dark)

flightbench = bench(6)
drone = group("Drone", (6, -1.05, 1.38))
box("Flight body", (0, 0, 0), (0.45, 0.67, 0.2), shell, 0.07, drone)
box("Flight controller", (0, -0.02, 0.14), (0.29, 0.32, 0.08), dark, 0.025, drone)
box("Battery restraint",(0,.02,.20),(.10,.33,.025),rubber,.008,drone)
cyl("Flight optical sensor",(0,-.36,0),.056,.06,glass,drone,"Y")
label("Flight identifier","BL / UAS",(-.18,-.344,.055),.039,dark,drone)
for x in (-.16,.16):
    cable("Flight antenna",[(x,.22,.16),(x,.25,.27),(x,.28,.44)],.009,dark,drone)
rotors=[]
for x in (-0.65, 0.65):
    for y in (-0.49, 0.49):
        arm = box("Flight arm", (x*0.55, y*0.55, -0.02), (0.83, 0.095, 0.075), dark, 0.02, drone)
        arm.rotation_euler.z=math.atan2(y, x)
        cyl("Rotor motor", (x,y,0.06), 0.1, 0.18, metal, drone)
        rotor=group("Rotor",(x,y,0.18),drone)
        box("Propeller",(0,0,0),(0.77,0.065,0.018),dark,0.018,rotor)
        rotors.append(rotor)
        box("Landing skid",(x*0.65,y*0.65,-0.19),(0.065,0.065,0.26),metal,0.01,drone)

phonebench=bench(11)
phone=group("Phone",(11,-1.05,1.78))
box("Device",(0,0,0),(0.71,0.11,1.42),dark,0.08,phone)
# Front faces are textured by the browser, after the initial chapter is ready.
box("PhoneScreen",(0,-0.061,0),(0.65,0.012,1.31),glass,0.015,phone)
box("Device stand",(0,0.2,-0.5),(0.38,0.25,0.75),metal,0.02,phone)
cyl("Camera dot",(0,-0.078,0.59),0.023,0.008,dark,phone,"Y",12)
monitor=group("Monitor",(16,-0.9,2))
box("Display case",(0,0,0),(2.3,0.15,1.25),dark,0.07,monitor)
box("RouteScreen",(0,-0.082,0),(2.16,0.01,1.11),glass,0.01,monitor)
box("Display neck",(0,0.05,-0.82),(0.15,0.2,0.56),metal,0.03,monitor)
bench(16)

def camera(name):
    data=bpy.data.cameras.new(name)
    o=bpy.data.objects.new(name,data)
    scene.collection.objects.link(o)
    data.lens=43
    return o


desktop=camera("CameraDesktop")
mobile=camera("CameraMobile")
scene.camera=desktop
camera_keys=[
    (0,(2.3,-4.3,2.95),(.30,-.12,1.85)),
    (.065,(4.9,-8.4,4.0),(0.5,-0.2,1.2)),
    (.14,(5.5,-8.6,4.8),(0.65,-.25,1.1)),
    (.205,(4,-5.3,3.8),(1.15,-.6,1.3)),
    (.245,(3.25,-3.8,2.85),(1.40,-.85,1.52)),
    (.28,(4.2,-5.7,3.4),(1,-.5,1.4)),
    (.34,(8.5,-8.3,4.5),(5,-.3,1.3)),
    (.415,(8.1,-5.4,3.7),(6,-.8,2.0)),
    (.465,(4.3,-6.2,3.9),(6.8,-.8,2.3)),
    (.52,(12,-8,4.0),(9.5,-.3,1.25)),
    (.62,(13.3,-6,3.2),(10.8,-.7,1.65)),
    (.70,(18,-8,4.2),(15,-.4,1.3)),
    (.80,(18.1,-6,3.5),(16,-.8,1.8)),
    (.88,(15,-13,7),(9,-.4,1.2)),
    (1,(12,-15,8),(6,-.3,1.0)),
]


def shot(p):
    for i in range(1,len(camera_keys)):
        b, a = camera_keys[i], camera_keys[i-1]
        if p <= b[0]:
            t=smooth(a[0],b[0],p)
            return lerp(a[1],b[1],t),lerp(a[2],b[2],t)
    return Vector(camera_keys[-1][1]),Vector(camera_keys[-1][2])


def aim_link(o, start, end):
    o.location=start
    o.rotation_mode="QUATERNION"
    o.rotation_quaternion=(Vector(end)-Vector(start)).to_track_quat("Z","Y")


# Rigid mechanical arms use a two-link reach constraint, sampled and baked.
def solve_arm(arm, target, frame, down=False, front=0):
    shoulder,upper,lower,wrist=arm
    s=Vector(shoulder)
    delta=Vector(target)-s
    d=min(delta.length,1.56)
    axis=delta.normalized()
    target=s+axis*d
    pole=Vector((.45 if s.x>0 else -.45,.8-1.6*front,.2))
    pole=(pole-axis*pole.dot(axis)).normalized()
    along=(0.8**2-0.78**2+d*d)/(2*d)
    elbow=s+axis*along+pole*math.sqrt(max(0,0.8**2-along**2))
    aim_link(upper,s,elbow)
    aim_link(lower,elbow,target)
    wrist.location=target
    wrist.rotation_mode="QUATERNION"
    wrist.rotation_quaternion=Vector((0,0,-1) if down else (0,-1,0)).to_track_quat("Z","Y")
    for o in (upper,lower,wrist): key(o,frame)
    return (Vector(target)-Vector(arm[3].location)).length


for frame in range(1,902):
    p=(frame-1)/900
    x=.25*smooth(.06,.12,p)*(1-smooth(.31,.38,p))+4.9*smooth(.31,.38,p)+5*smooth(.47,.55,p)+5*smooth(.68,.745,p)-9.9*smooth(.88,1,p)
    phone_approach=smooth(.52,.55,p)*(1-smooth(.665,.69,p))
    x-=.9*phone_approach
    y=-.8*phone_approach
    robot.location=(x,y,0)
    moving=smooth(.31,.335,p)*(1-smooth(.355,.38,p))+smooth(.47,.49,p)*(1-smooth(.525,.55,p))+smooth(.68,.705,p)*(1-smooth(.73,.745,p))
    returning=smooth(.88,.905,p)*(1-smooth(.975,1,p))
    robot.rotation_mode="QUATERNION"
    robot.rotation_quaternion=Euler((0,0,(moving-returning)*math.pi/2)).to_quaternion()
    key(robot,frame)
    distance=.25*smooth(.06,.12,p)+4.65*smooth(.31,.38,p)+5*smooth(.47,.55,p)+5*smooth(.68,.745,p)+9.9*smooth(.88,1,p)+1.204*(smooth(.52,.55,p)+smooth(.665,.69,p))
    for wheel in wheels:
        wheel.rotation_mode="QUATERNION"
        wheel.rotation_quaternion=Euler((distance/.29,0,0)).to_quaternion()
        key(wheel,frame)
    grip_closed=smooth(.145,.16,p)*(1-smooth(.285,.30,p))
    for finger,side,sign in fingers:
        finger.location.x=sign*(.15-.044*grip_closed if side==1 else .12)
        key(finger,frame)
    head.rotation_mode="QUATERNION"
    head.rotation_quaternion=Euler((0.16*smooth(.02,.07,p)*(1-smooth(.11,.14,p)),0,-0.25*math.sin(p*math.pi*4)+.9*phone_approach)).to_quaternion()
    key(head,frame)
    # Hold through both engagement boundaries; ramp endpoints land on baked frames.
    reach=smooth(.16,183/900,p)*(1-smooth(240/900,255/900,p))
    for i,arm in enumerate(arms):
        side=-1 if i==0 else 1
        rest=Vector((side*.87,-.12,.92))
        target=rest
        if i==1:
            dock_grip=tool_dock+Vector((-x,0,.29))
            working=contact-Vector((x,0,-.8025))
            pickup=smooth(.12,.16,p)*(1-smooth(.285,.31,p))
            target=rest.lerp(dock_grip,pickup).lerp(working,reach)
            launch=smooth(.375,.391,p)*(1-smooth(.409,.43,p))
            target=target.lerp(Vector((5.4-x,-.9,1.45)),launch)
            # Clear the display's left edge before crossing its front plane.
            touch=smooth(.55,.575,p)*(1-smooth(.637,.665,p))
            tap=smooth(.578,.60,p)*(1-smooth(.615,.635,p))
            target=target.lerp(Vector((10.30-x,-1.4815-y,1.7)),touch)
            target=target.lerp(Vector((11-x,-1.4815-y,1.7)),tap)
        solve_arm(arm,target,frame,down=(i==1),front=phone_approach if i==1 else 0)
        if i==1:
            wrist=arm[3]
            downward=Vector((0,0,-1)).to_track_quat("Z","Y")
            forward=Vector((0,1,0)).to_track_quat("Z","Y")
            wrist.rotation_quaternion=downward.slerp(forward,touch)
            key(wrist,frame)
    tool.rotation_mode="QUATERNION"
    tool.rotation_quaternion=Vector((0,0,-1)).to_track_quat("Z","Y")
    if .16 <= p <= .285:
        tool.location=Vector(arms[1][3].location)+Vector((x,0,-.29))
    else:
        tool.location=tool_dock
    key(tool,frame)
    driver_spinner.rotation_mode="QUATERNION"
    driver_spinner.rotation_quaternion=Euler((0,0,-smooth(.21,.26,p)*math.pi*8)).to_quaternion()
    key(driver_spinner,frame)
    fastener.rotation_mode="QUATERNION"
    fastener.rotation_quaternion=Euler((0,0,smooth(.21,.26,p)*math.pi*8)).to_quaternion()
    key(fastener,frame)
    drone.location=(6+smooth(.43,.52,p)*1.4,-1.05,1.38+1.25*smooth(.375,.43,p)*(1-smooth(.48,.53,p)))
    drone.rotation_mode="QUATERNION"
    drone.rotation_quaternion=Euler((0,.1*math.sin(smooth(.38,.5,p)*math.pi),.28*smooth(.43,.52,p))).to_quaternion()
    key(drone,frame)
    for rotor in rotors:
        rotor.rotation_mode="QUATERNION"
        rotor.rotation_quaternion=Euler((0,0,smooth(.36,.53,p)*math.pi*94)).to_quaternion()
        key(rotor,frame)
    pos,target=shot(p)
    for cam,extra in ((desktop,0),(mobile,2.6)):
        phone_frame=smooth(.52,.575,p)*(1-smooth(.655,.72,p)) if cam==mobile else 0
        framing=Vector((-.75*phone_frame,0,0))
        cam.location=pos+framing+Vector((0,-extra-.45*phone_frame,extra*.18+.08*phone_frame))
        cam.rotation_mode="QUATERNION"
        cam.rotation_quaternion=(target+framing-cam.location).to_track_quat("-Z","Y")
        key(cam,frame)

scene.frame_set(1)
OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/"bill-workshop.blend"))
bpy.ops.export_scene.gltf(
    filepath=str(OUT/"bill-workshop.glb"), export_format="GLB",
    export_cameras=True, export_animations=True, export_animation_mode="SCENE",
    export_frame_range=True, export_frame_step=1,
    export_optimize_animation_size=True, export_force_sampling=True,
)
print("Workshop authored, baked and exported.")
