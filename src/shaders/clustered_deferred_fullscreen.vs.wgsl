// TODO-3: implement the Clustered Deferred fullscreen vertex shader

// This shader should be very simple as it does not need all of the information passed by the the naive vertex shader.


@vertexfn main() 
{
    let pos = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>( 1.0,  1.0),
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0,  1.0),
        vec2<f32>(-1.0,  1.0)
    );

    let uv = array<vec2<f32>, 6>(
        vec2<f32>(0, 0),
        vec2<f32>(1, 0),
        vec2<f32>(1, 1),
        vec2<f32>(0, 0),
        vec2<f32>(1, 1),
        vec2<f32>(0, 1)
    );
}