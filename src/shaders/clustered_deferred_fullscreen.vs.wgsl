// TODO-3: implement the Clustered Deferred fullscreen vertex shader

// This shader should be very simple as it does not need all of the information passed by the the naive vertex shader.


struct VertexOutput
{
    @builtin(position) fragPos: vec4f,
    @location(0) uv: vec2f,
}

@vertex 
fn main(@builtin(vertex_index) vertID: u32) -> VertexOutput
{
    let ndcPos = array<vec4<f32>, 3>(
        vec4<f32>(-3.0, -1.0, 1.0, 1.0),
        vec4<f32>( 1.0, -1.0, 1.0, 1.0),
        vec4<f32>( 1.0,  3.0, 1.0, 1.0),
    );

    let uv = array<vec2<f32>, 3>(
        vec2<f32>(-1, 1),
        vec2<f32>(1, 1),
        vec2<f32>(1, -1),
    );

    var out: VertexOutput;
    out.fragPos = ndcPos[vertID];
    out.uv = uv[vertID];
    return out;
}