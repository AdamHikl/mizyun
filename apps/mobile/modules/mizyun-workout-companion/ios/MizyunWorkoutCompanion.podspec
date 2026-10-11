Pod::Spec.new do |s|
  s.name = 'MizyunWorkoutCompanion'
  s.version = '1.0.0'
  s.summary = 'Dev-only foreground manual workout companion transport.'
  s.description = 'WatchConnectivity transport without credentials, health sensors or native mutations.'
  s.license = { :type => 'MIT' }
  s.author = 'Mizyun'
  s.homepage = 'https://www.phiskel.com/mizyun'
  s.platform = :ios, '16.4'
  s.swift_version = '5.9'
  s.source = { :git => 'https://github.com/AdamHikl/mizyun.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WatchConnectivity'
  s.source_files = '**/*.swift'
end
