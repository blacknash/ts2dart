require('source-map-support').install();

var formatter = require('gulp-clang-format');
var fsx = require('fs-extra');
var gulp = require('gulp');
var gutil = require('gulp-util');
var merge = require('merge2');
var mocha = require('gulp-mocha');
var sourcemaps = require('gulp-sourcemaps');
var spawn = require('child_process').spawn;
var tmpdir = require('os').tmpdir;
var temp = require('temp');  //.track();  // track => delete temp files on exit.
var ts = require('gulp-typescript');
var which = require('which');

var TSC_OPTIONS = {
  module: "commonjs",
  // allow pulling in files from node_modules
  // until TS 1.5 is in tsd / DefinitelyTyped
  // (the alternative is to include node_modules paths
  // in the src arrays below for compilation)
  noExternalResolve: false,
  declarationFiles: true,
  noEmitOnError: true,
};
var tsProject = ts.createProject(TSC_OPTIONS);

gulp.task('test.check-format', function() {
  return gulp.src(['*.js', '*.ts', 'test/**/*.ts']).pipe(formatter.checkFormat('file'));
});

var hasCompileError;
var failOnError = true;

var onCompileError = function(err) {
  hasCompileError = true;
  gutil.log(err.message);
  if (failOnError) {
    process.exit(1);
  }
};

gulp.task('compile', function() {
  hasCompileError = false;
  var tsResult = gulp.src(['*.ts', 'typings/**/*.d.ts'])
                     .pipe(sourcemaps.init())
                     .pipe(ts(tsProject))
                     .on('error', onCompileError);
  return merge([
    tsResult.dts.pipe(gulp.dest('release/definitions')),
    // Write external sourcemap next to the js file
    tsResult.js.pipe(sourcemaps.write('.')).pipe(gulp.dest('release/js')),
    tsResult.js.pipe(gulp.dest('release/js')),
  ]);
});

gulp.task('test.compile', ['compile'], function(done) {
  if (hasCompileError) {
    done();
    return;
  }
  return gulp.src(['test/*.ts', '*.ts', 'typings/**/*.d.ts'])
      .pipe(sourcemaps.init())
      .pipe(ts(tsProject))
      .on('error', onCompileError)
      .js.pipe(sourcemaps.write())
      .pipe(gulp.dest('release/js/test'));
});

gulp.task('test.unit', ['test.compile'], function(done) {
  if (hasCompileError) {
    done();
    return;
  }
  return gulp.src('release/js/test/*.js').pipe(mocha());
});

// This test transpiles some unittests to dart and runs them in the Dart VM.
gulp.task('test.e2e', ['test.compile'], function(done) {
  var testfile = 'helloworld';

  // Set up the test env in a hermetic tmp dir
  var dir = temp.mkdirSync('ts2dart');
  gutil.log('E2E test files generated in', dir);
  fsx.copySync(__dirname + '/test/e2e', dir);

  // run node with a shell so we can wildcard all the .ts files
  spawn('sh', ['-c', 'node release/js/main.js ' + dir + '/*.ts'], {stdio: 'inherit'})
      .on('close', function(code, signal) {
        if (code > 0) {
          onCompileError(new Error("Failed to transpile " + testfile + '.ts'));
        } else {
          try {
            var opts = {stdio: 'inherit', cwd: dir};
            // Install the unittest packages on every run, using the content of pubspec.yaml
            // TODO: maybe this could be memoized or served locally?
            spawn(which.sync('pub'), ['install'], opts)
                .on('close', function() {
                  // Run the tests using built-in test runner.
                  spawn(which.sync('dart'), [testfile + '.dart'], opts).on('close', done);
                });
          } catch (e) {
            console.log('Dart SDK is not found on the PATH:', e.message);
            throw e;
          }
        }
      });


});

gulp.task('test', ['test.unit', 'test.check-format', 'test.e2e']);

gulp.task('watch', ['test.unit'], function() {
  failOnError = false;
  // Avoid watching generated .d.ts in the release (aka output) directory.
  return gulp.watch(['*.ts', 'test/**/*.ts'], {ignoreInitial: true}, ['test.unit']);
});

gulp.task('default', ['compile']);