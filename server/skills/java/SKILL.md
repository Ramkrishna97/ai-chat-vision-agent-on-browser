# Java, Maven, and Gradle
Description: Build and run plain Java programs and Maven or Gradle projects.

Create complete source files with write_file. For plain Java, run_project accepts a .java file or project folder and compiles all related sources. For Maven, write pom.xml and conventional src/main/java sources; for Gradle, write build.gradle or build.gradle.kts and sources. Then call run_project with action run. The runner uses project wrappers when present and runs tests before Maven or Gradle applications. If there are multiple main classes, pass mainClass. Inspect compiler, test, and runtime errors, then correct and rerun.
