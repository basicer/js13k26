// Valid modules used both by dependency-free tests and the compiler oracle.
export const fixtures = {
	"nested comments and hexadecimal/exponent literals": `
    /* outer /* nested */ still a comment */
    @group(0) @binding(0) var<storage, read_write> result: array<f32>;
    @compute @workgroup_size(1) fn main() {
      result[0] = 0x1.8p+1f + 0X2p-1f + .5e+1f + 1e-2f;
      result[1] = f32(0xffu) + f32(0X10i);
    }
  `,
	"attributes, override names and builtin/local name collisions": `
    override sample_count: u32 = 1u;
    struct Output {
      @builtin(position) position: vec4<f32>,
      @location(0) @interpolate(flat) value: f32,
    }
    @vertex fn main(@builtin(vertex_index) index: u32) -> Output {
      let flat = f32(index + sample_count);
      let position = vec4<f32>(0.0f, 0.0f, 0.0f, 1.0f);
      let thing = abs(-flat);
      { let abs = thing; return Output(position, abs); }
    }
  `,
	"compound shifts, switch default, aliases and nested templates": `
    alias Words = array<array<u32, 2>, 2>;
    @group(0) @binding(0) var<storage, read_write> result: Words;
    @compute @workgroup_size(1) fn main() {
      var value = result[0][0];
      value <<= 1u; value >>= 1u;
      switch value { case 0u: { value++; } default: { value--; } }
      result[1][1] = value;
    }
  `,
	"Unicode identifiers": `
    @group(0) @binding(0) var<storage, read_write> résultat: array<f32>;
    @compute @workgroup_size(1) fn main() {
      let 朝焼け = résultat[0]; résultat[1] = 朝焼け;
    }
  `,
	"predeclared result fields and same-named user members": `
    struct Data { fract: f32, exp: i32, abs: f32, }
    @group(0) @binding(0) var<storage, read_write> result: array<f32>;
    @compute @workgroup_size(1) fn main() {
      let parts = frexp(result[0]);
      let data = Data(parts.fract, parts.exp, abs(result[0]));
      result[1] = data.fract + f32(data.exp) + data.abs;
    }
  `,
};
