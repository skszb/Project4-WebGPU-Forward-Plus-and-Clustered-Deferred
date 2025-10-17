// TODO-2: implement the light clustering compute shader

// ------------------------------------
// Calculating cluster bounds:
// ------------------------------------
// For each cluster (X, Y, Z):
//     - Calculate the screen-space bounds for this cluster in 2D (XY).
//     - Calculate the depth bounds for this cluster in Z (near and far planes).
//     - Convert these screen and depth bounds into view-space coordinates.
//     - Store the computed bounding box (AABB) for the cluster.

// ------------------------------------
// Assigning lights to clusters:
// ------------------------------------
// For each cluster:
//     - Initialize a counter for the number of lights in this cluster.

//     For each light:
//         - Check if the light intersects with the cluster’s bounding box (AABB).
//         - If it does, add the light to the cluster's light list.
//         - Stop adding lights if the maximum number of lights is reached.

//     - Store the number of lights assigned to this cluster.

@group(0) @binding(0) var<uniform> cameraUniforms: CameraUniforms;
@group(0) @binding(1) var<storage, read> lightSet: LightSet;

// cluster generation pass
@group(1) @binding(0) var<uniform> clusterParams: ClusterParams;
@group(1) @binding(1) var<storage, read_write> clusterAABBs: array<AABB>;
@group(1) @binding(2) var<storage, read_write> clusterSets: ClusterSet;


// AABB calculation pass
@compute @workgroup_size(4, 4, 4)
fn calculateClusterBounds(@builtin(global_invocation_id) globalIdx: vec3u)
{
    var clusterCount = clusterParams.numClusters;
    var clusterIndex = vec3(globalIdx.x, globalIdx.y, globalIdx.z);

    if (clusterIndex.x >= clusterCount.x || clusterIndex.y >= clusterCount.y || clusterIndex.z >= clusterCount.z)
    {
        return;
    }

    var flattendClusterIndex = flattenClusterIndex(clusterIndex);
    
    // size of each cluster in NDC
    var clusterXLength_ndc = 2.f / f32(clusterCount.x);
    var clusterYLength_ndc = 2.f / f32(clusterCount.y);

    var xMin_ndc = -1.0;
    var yMin_ndc = -1.0;


    // slice x, y in ndc
    var clusterMinX_ndc = xMin_ndc + f32(clusterIndex.x) * clusterXLength_ndc;
    var clusterMaxX_ndc = clusterMinX_ndc + clusterXLength_ndc;
    var clusterMinY_ndc = yMin_ndc + f32(clusterIndex.y) * clusterYLength_ndc;
    var clusterMaxY_ndc = clusterMinY_ndc + clusterYLength_ndc;

    // slice z in view then convert to ndc
    // var clusterZNear_view = -((cameraUniforms.zFar - cameraUniforms.zNear) * f32(clusterIndex.z) / f32(clusterParams.numClusters.z) + cameraUniforms.zNear);
    var clusterZNear_view = -cameraUniforms.zNear * pow(f32(cameraUniforms.zFar) / f32(cameraUniforms.zNear), f32(clusterIndex.z) / f32(clusterParams.numClusters.z));
    var minZ_ndc_vec = cameraUniforms.projMat * vec4<f32>(0.0,0.0,clusterZNear_view,1.0);
    var minZ_ndc = minZ_ndc_vec.z/minZ_ndc_vec.w;

    // var clusterZFar_view = -((cameraUniforms.zFar - cameraUniforms.zNear) * f32(clusterIndex.z + 1) / f32(clusterParams.numClusters.z) + cameraUniforms.zNear);
    var clusterZFar_view = -cameraUniforms.zNear * pow(f32(cameraUniforms.zFar) / f32(cameraUniforms.zNear), f32(clusterIndex.z + 1) / f32(clusterParams.numClusters.z));
    var maxZ_ndc_vec = cameraUniforms.projMat * vec4<f32>(0.0,0.0,clusterZFar_view,1.0);
    var maxZ_ndc = maxZ_ndc_vec.z/maxZ_ndc_vec.w;
    

    // cluster AABB in ndc, then to view.
    var clusterCorners_ndc : array<vec4f, 4>;
    clusterCorners_ndc[0] = vec4f(clusterMinX_ndc, clusterMinY_ndc, minZ_ndc, 1.0); // near min
    clusterCorners_ndc[1] = vec4f(clusterMaxX_ndc, clusterMinY_ndc, minZ_ndc, 1.0); // near max
    clusterCorners_ndc[2] = vec4f(clusterMinX_ndc, clusterMaxY_ndc, maxZ_ndc, 1.0); // far min
    clusterCorners_ndc[3] = vec4f(clusterMaxX_ndc, clusterMaxY_ndc, maxZ_ndc, 1.0); // far max

    var min_view = vec3f(1000000, 1000000, 1000000);
    var max_view = vec3f(-1000000, -1000000, -1000000);
    for (var i = 0u; i < 4u; i++) 
    {
        var corner_view = ndcToView(clusterCorners_ndc[i]);
        min_view = min(min_view, corner_view);
        max_view = max(max_view, corner_view);
    }

    clusterAABBs[flattendClusterIndex] = AABB(min_view, max_view);
}   

fn ndcToView(v: vec4f) -> vec3f {
    let ret = cameraUniforms.invProjMat * v;
    return ret.xyz / ret.w;
}


// light culling pass
fn lightIntersectAABB(lightPos_world: vec3f, bound: AABB) -> bool
{
    var lightPos_view = (cameraUniforms.viewMat * vec4(lightPos_world, 1.f)).xyz;
    
    var diff = clamp(lightPos_view.xyz, bound.min, bound.max) - lightPos_view;
    var distSqr = dot(diff, diff);

    if (distSqr > (${lightRadius} * ${lightRadius}))
    {
        return false;
    }

    return true;
}

@compute @workgroup_size(${workGroupSize[0]}, ${workGroupSize[1]}, ${workGroupSize[2]})
fn lightCulling(@builtin(global_invocation_id) globalIdx: vec3u)
{
    var clusterIndex = vec3(globalIdx.x, globalIdx.y, globalIdx.z);
    var clusterCount = clusterParams.numClusters;
    if (clusterIndex.x >= clusterCount.x || clusterIndex.y >= clusterCount.y || clusterIndex.z >= clusterCount.z)
    {
        return;
    }

    var flattendClusterIndex = flattenClusterIndex(clusterIndex);

    // light culling local storage
    var clusterLightCount= 0u;
    var clusterLightIdicesList: array<u32, ${maxNumLightsPerCluster}>;

    var clusterAABB = clusterAABBs[flattendClusterIndex];

    for (var i = 0u; i < lightSet.numLights; i++)
    {
        if (clusterLightCount >= ${maxNumLightsPerCluster}) { break; }
        var lightPos_world = lightSet.lights[i].pos;
        if (lightIntersectAABB(lightPos_world, clusterAABB))
        {
            clusterLightIdicesList[clusterLightCount] = i;
            clusterLightCount++;
        }
    }
    
    var lightBufferAppendStart = atomicAdd(&clusterSets.numLights, u32(clusterLightCount));
    for (var i = 0u; i < clusterLightCount; i++)
    {
        clusterSets.lightIndicesList[lightBufferAppendStart + i] = clusterLightIdicesList[i];
    }
    clusterSets.lightGrid[flattendClusterIndex] = vec2<u32>(lightBufferAppendStart, clusterLightCount);
}